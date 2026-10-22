import { CONFIG as C } from './config.js'
import * as S from './sentinel-core.js'

const $ = (id) => document.getElementById(id)
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
const short = (h) => `${h.slice(0, 10)}…${h.slice(-6)}`
const addr = (a) => `<a class="mono" href="${C.explorer}/address/${a}" target="_blank" rel="noopener">${short(a)}</a>`
const txl = (h) => `<a class="mono" href="${C.explorer}/tx/${h}" target="_blank" rel="noopener">${short(h)}</a>`
const pctE18 = (v) => `${(Number(BigInt(v) / 10n ** 14n) / 100).toFixed(2)}%`
const musd = (wei) => `${Number(BigInt(wei) / 10n ** 18n).toLocaleString()} MUSD`
const when = (t) => new Date(t * 1000).toLocaleString(undefined, { timeZoneName: 'short' })

async function rpc(url, method, params) {
	const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
	const j = await r.json()
	if (j.error) throw new Error(`${method}: ${j.error.message}`)
	return j.result
}
const getJson = async (u) => { const r = await fetch(u); if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json() }

async function lensSnapshot(block) {
	const data = S.encodeFunctionData({ abi: S.LENS_ABI, functionName: 'snapshot', args: [C.vault, BigInt(C.maxWalk), BigInt(C.frontN)] })
	const out = await rpc(C.mezoRpc, 'eth_call', [{ to: C.sentinelLens, data, gas: '0x1c9c380' }, block])
	return S.decodeLensSnapshot(out)
}

async function gatherEvidence() {
	const head = BigInt(await rpc(C.mezoRpc, 'eth_blockNumber', []))
	const pinned = `0x${(head - BigInt(C.confirmations)).toString(16)}`
	const [mezo, clRaw, cg, cb] = await Promise.all([
		lensSnapshot(pinned),
		rpc(C.ethRpc, 'eth_call', [{ to: C.chainlinkBtcUsd, data: S.encodeFunctionData({ abi: S.AGGREGATOR_V3_ABI, functionName: 'latestRoundData' }) }, 'latest']),
		getJson(C.coingecko),
		getJson(C.coinbase),
	])
	const [roundId, answer, , updatedAt] = S.decodeFunctionResult({ abi: S.AGGREGATOR_V3_ABI, functionName: 'latestRoundData', data: clRaw })
	return S.buildEvidence(Math.floor(Date.now() / 1000), mezo, S.chainlinkRound(roundId, answer, updatedAt), {
		btcUsdCentsCoingecko: S.toCents(cg.bitcoin.usd),
		btcUsdCentsCoinbase: S.toCents(Number(cb.data.amount)),
		musdUsdMicros: S.toMicros(cg['mezo-usd'].usd),
	})
}

function renderKpis(m) {
	const k = (label, v) => `<div class="kpi"><span>${label}</span><b>${v}</b></div>`
	$('kpis').innerHTML = [
		k('ICR (trigger → target)', `${pctE18(m.icrE18)} <span class="mut" style="font-size:12px">${pctE18(m.triggerE18)} → ${pctE18(m.targetE18)}</span>`),
		k('Redemption queue position', `${m.rankFromFront} / ${m.queueSize}`),
		k('Debt ahead of this trove', musd(m.debtAheadWei)),
		k('Rescue reserve', `${(Number(BigInt(m.reserveBtcWei) / 10n ** 12n) / 1e6).toFixed(6)} BTC`),
		k('Trove debt', musd(m.debtWei)),
		k('Mezo BTC price', `$${(Number(BigInt(m.priceE18) / 10n ** 16n) / 100).toLocaleString()}`),
		k('System TCR', `${pctE18(m.tcrE18)}${m.recoveryMode ? ' ⚠ recovery' : ''}`),
		k('Vault flags', `${m.needsProtection ? '<span class="no">needs protection</span>' : '<span class="ok">ok</span>'} · ${m.redemptionRisk ? '<span class="no">redemption risk</span>' : '<span class="ok">no redemption risk</span>'}`),
	].join('')
	$('queueRows').innerHTML = m.front
		.map((q, i) => `<tr${q.borrower === m.vault ? ' style="background:#1b2129"' : ''}><td>${i + 1}</td><td>${addr(q.borrower)}</td><td>${pctE18(q.icrE18)}</td><td>${musd(q.debtWei)}</td></tr>`)
		.join('') + `<tr><td>…</td><td colspan="3" class="mut">this vault is #${m.rankFromFront}, with ${musd(m.debtAheadWei)} of debt ahead (block ${m.block})</td></tr>`
}

function renderDecision(d, el) {
	const args = (c) => c.arguments.map((a) => `<div class="arg"><b>+${a.points}</b> ${esc(a.claim)}<br><small>${a.id} · evidence: ${a.evidence.map((p) => `<code>${p}</code>`).join(' ')}</small></div>`).join('') || '<div class="mut">no arguments</div>'
	el.innerHTML = `
	<div class="grid g3">
		<div class="bull"><h2 style="color:var(--bull)">🐂 Bull <span class="score">${d.bull.score}</span></h2>${args(d.bull)}</div>
		<div class="bear"><h2 style="color:var(--bear)">🐻 Bear <span class="score">${d.bear.score}</span></h2>${args(d.bear)}</div>
		<div><h2 style="color:var(--judge)">⚖️ Judge (policy v1)</h2>
			<div class="trail">${d.trail.map((s) => `<div><span class="${s.passed ? 'ok' : 'no'}">${s.passed ? '✔' : '✘'}</span> <code>${s.rule}</code> <span class="mut">${esc(s.detail)}</span></div>`).join('')}</div>
			<p><span class="pill ${d.actionName}">${d.actionName}</span> confidence ${(d.confidenceBps / 100).toFixed(1)}% · practice <b>${d.practiceName}</b></p>
		</div>
	</div>
	<details><summary class="mut">hashes</summary><pre>evidenceHash  ${d.evidenceHash}\npolicyHash    ${d.policyHash}\nreasoningHash ${d.reasoningHash}</pre></details>`
}

async function runNow() {
	$('runBtn').disabled = true
	$('runStatus').textContent = 'gathering evidence…'
	try {
		const e = await gatherEvidence()
		renderKpis(e.mezo)
		const d = S.decide(e)
		renderDecision(d, $('runOut'))
		$('runStatus').textContent = `done · Mezo block ${e.mezo.block}`
		const pre = document.createElement('details')
		pre.innerHTML = `<summary class="mut">full evidence record (canonical JSON that was hashed)</summary><pre>${esc(S.canonicalize(e))}</pre>`
		$('runOut').appendChild(pre)
	} catch (err) {
		$('runStatus').textContent = `failed: ${err.message}`
	} finally {
		$('runBtn').disabled = false
	}
}

let evidenceIndex = []
async function loadLog() {
	try { evidenceIndex = await getJson('./evidence/index.json') } catch { evidenceIndex = [] }
	const logs = await rpc(C.mezoRpc, 'eth_getLogs', [{ address: C.decisionLog, fromBlock: `0x${C.decisionLogDeployBlock.toString(16)}`, toBlock: 'latest' }])
	const rows = []
	const disputes = {}
	for (const l of logs) {
		let ev
		try { ev = S.decodeEventLog({ abi: S.DECISION_LOG_ABI, data: l.data, topics: l.topics }) } catch { continue }
		if (ev.eventName === 'DecisionLogged') rows.push({ ...ev.args, tx: l.transactionHash, block: Number(l.blockNumber) })
		if (ev.eventName === 'DecisionDisputed') disputes[ev.args.id] = (disputes[ev.args.id] ?? 0) + 1
	}
	$('logMeta').textContent = `· ${rows.length} decision${rows.length === 1 ? '' : 's'} on Mezo testnet`
	if (!rows.length) { $('logRows').innerHTML = '<tr><td colspan="7" class="mut">no decisions yet</td></tr>'; return }
	const A = ['HOLD', 'WATCH', 'PROTECT', 'ESCALATE', 'ABSTAIN'], P = ['NONE', 'REDEMPTION_ARB', 'HEDGE']
	rows.reverse()
	$('logRows').innerHTML = rows.map((r) => {
		const rec = evidenceIndex.find((x) => x.evidenceHash === r.evidenceHash)
		return `<tr><td>${r.id}</td><td>${rec ? when(rec.observedAt) : `block ${r.block}`}</td><td><span class="pill ${A[r.action]}">${A[r.action]}</span>${disputes[r.id] ? ` <span class="no">disputed ×${disputes[r.id]}</span>` : ''}</td><td>${P[r.practice]}</td><td>${(r.icrBps / 100).toFixed(2)}%</td>
		<td class="mono">ev ${short(r.evidenceHash)}<br>pol ${short(r.policyHash)}<br>tx ${txl(r.tx)}</td>
		<td>${rec ? `<button class="sec" data-ev="${r.evidenceHash}" data-id="${r.id}">Verify</button>` : '<span class="mut">evidence not published</span>'}</td></tr>`
	}).join('')
	for (const b of document.querySelectorAll('button[data-ev]')) b.onclick = () => verify(rows.find((r) => r.evidenceHash === b.dataset.ev))
}

async function verify(row) {
	const out = $('verifyOut')
	out.innerHTML = '<p class="mut">replaying…</p>'
	const rec = await getJson(`./evidence/${row.evidenceHash}.json`)
	const d = S.decide(rec.evidence)
	const chk = (label, a, b) => `<div><span class="${a === b ? 'ok' : 'no'}">${a === b ? '✔' : '✘'}</span> ${label} <code>${short(a)}</code> ${a === b ? 'matches the chain' : `≠ on-chain <code>${short(b)}</code>`}</div>`
	out.innerHTML = `<h2 style="margin-top:16px">Replay of decision #${row.id}</h2>
		${chk('evidence hash (keccak of the published evidence JSON)', d.evidenceHash, row.evidenceHash)}
		${chk('policy hash (policy v1 bundled in this page)', d.policyHash, row.policyHash)}
		${chk('reasoning hash (bull + bear + judge trail)', d.reasoningHash, row.reasoningHash)}
		<div><span class="${d.action === row.action ? 'ok' : 'no'}">${d.action === row.action ? '✔' : '✘'}</span> action ${d.actionName}</div><div id="vdec" style="margin-top:12px"></div>`
	renderDecision(d, $('vdec'))
}

async function loadBacktest() {
	const idx = await getJson('./backtest/index.json')
	const link = (note) => esc(note).replace(/0x[0-9a-f]{64}/g, (h) => txl(h))
	$('btRows').innerHTML = idx.map((r) => `<tr><td class="mono">${r.block}</td><td>${when(r.observedAt)}</td><td><span class="pill ${r.action}">${r.action}</span></td><td>${(r.icrBps / 100).toFixed(2)}%</td><td><span class="ok">${r.bull}</span> / <span class="no">${r.bear}</span></td><td>${link(r.note)}</td><td><button class="sec" data-bt="${r.block}">Replay</button></td></tr>`).join('')
	for (const b of document.querySelectorAll('button[data-bt]'))
		b.onclick = async () => {
			const rec = await getJson(`./backtest/${b.dataset.bt}.json`)
			const d = S.decide(rec.evidence)
			$('btOut').innerHTML = `<h2 style="margin-top:16px">Block ${b.dataset.bt}: recomputed in your browser ${d.reasoningHash === rec.decision.reasoningHash ? '<span class="ok">✔ same reasoning hash</span>' : '<span class="no">✘ mismatch</span>'}</h2><div id="btDec"></div>`
			renderDecision(d, $('btDec'))
		}
}

async function loadPolicy() {
	const ph = S.policyHash()
	$('policyJson').textContent = JSON.stringify(S.POLICY_V1, null, 2)
	try {
		const out = await rpc(C.mezoRpc, 'eth_call', [{ to: C.decisionLog, data: S.encodeFunctionData({ abi: S.DECISION_LOG_ABI, functionName: 'policies', args: [ph] }) }, 'latest'])
		const [active, registeredAt] = S.decodeFunctionResult({ abi: S.DECISION_LOG_ABI, functionName: 'policies', data: out })
		$('policyCheck').innerHTML = active
			? `<span class="ok">✔ registered and active on DecisionLog</span> since ${when(Number(registeredAt))}<br><code>${ph}</code>`
			: `<span class="no">✘ hash ${short(ph)} is not active on-chain</span>`
	} catch (e) { $('policyCheck').textContent = `could not check: ${e.message}` }
}

$('addrs').innerHTML = `vault ${addr(C.vault)} · SentinelLens ${addr(C.sentinelLens)} · DecisionLog ${addr(C.decisionLog)} · relayer ${addr(C.relayer)}`
$('repoLink').href = C.repo
$('runBtn').onclick = runNow
lensSnapshot('latest').then(renderKpis).catch((e) => ($('kpis').innerHTML = `<div class="kpi"><span>snapshot failed: ${esc(e.message)}</span></div>`))
loadLog().catch((e) => ($('logRows').innerHTML = `<tr><td colspan="7" class="no">${esc(e.message)}</td></tr>`))
loadPolicy()
loadBacktest().catch((e) => ($('btRows').innerHTML = `<tr><td colspan="7" class="no">${esc(e.message)}</td></tr>`))
