// Local runner: the same evidence -> agents -> judge -> report pipeline as the CRE workflow, using plain
// fetch() instead of CRE capabilities. Used for (a) relaying decisions to Mezo while CRE cannot write there,
// (b) producing the evidence files the dashboard replays, (c) a demo without a CRE account.
//
//   bun cli.ts                 # gather live evidence, decide, print (no transaction)
//   bun cli.ts --relay         # ...and post the report to DecisionLog on Mezo testnet (relayer key)
//   bun cli.ts --replay FILE   # recompute a saved decision and check every hash
//   bun cli.ts --at-block N    # backtest: rebuild evidence as of a past Mezo block (archive state + SentinelLens
//                              # code injected via eth_call state override; Chainlink round, Coinbase candle and
//                              # CoinGecko point as of that block time). Never relayed: DecisionLog only accepts newer data.
import { createPublicClient, createWalletClient, encodeFunctionData, http, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import {
	AGGREGATOR_V3_ABI, CHAINLINK_BTC_USD_MAINNET, DECISION_LOG_ABI, LENS_ABI, MEZO_TESTNET,
	buildEvidence, canonicalize, chainlinkRound, decide, decodeLensSnapshot, encodeReport, toCents, toMicros, type Evidence,
} from './core'

const ROOT = new URL('../../', import.meta.url).pathname
const dep = JSON.parse(readFileSync(ROOT + 'deployments/mezo-testnet.json', 'utf8'))
const cfg = {
	mezoRpc: process.env.MEZO_RPC ?? MEZO_TESTNET.rpc,
	ethRpc: process.env.ETH_RPC ?? 'https://ethereum-rpc.publicnode.com',
	vault: (process.env.VAULT ?? MEZO_TESTNET.lifelineVault) as Hex,
	lens: dep.sentinelLens as Hex,
	decisionLog: dep.decisionLog as Hex,
	confirmations: 2n,
	maxWalk: 400n,
	frontN: 5n,
}

const mezoChain = {
	id: 31611, name: 'Mezo Testnet', nativeCurrency: { name: 'Bitcoin', symbol: 'BTC', decimals: 18 },
	rpcUrls: { default: { http: [cfg.mezoRpc] } },
} as const

async function getJson(url: string) {
	const r = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'lifeline-sentinel/1.0' } })
	if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`)
	return r.json() as Promise<any>
}

export async function gatherEvidence(observedAt = Math.floor(Date.now() / 1000)): Promise<Evidence> {
	const mezo = createPublicClient({ chain: mezoChain, transport: http(cfg.mezoRpc) })
	const eth = createPublicClient({ transport: http(cfg.ethRpc) })
	const head = await mezo.getBlockNumber()
	const blockNumber = head - cfg.confirmations
	const data = encodeFunctionData({ abi: LENS_ABI, functionName: 'snapshot', args: [cfg.vault, cfg.maxWalk, cfg.frontN] })
	const res = await mezo.call({ to: cfg.lens, data, blockNumber, gas: 30_000_000n })
	const snap = decodeLensSnapshot(res.data!)
	const [roundId, answer, , updatedAt] = await eth.readContract({ address: CHAINLINK_BTC_USD_MAINNET, abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData' })
	const cg = await getJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,mezo-usd&vs_currencies=usd')
	const cb = await getJson('https://api.coinbase.com/v2/prices/BTC-USD/spot')
	return buildEvidence(observedAt, snap, chainlinkRound(roundId, answer, updatedAt), {
		btcUsdCentsCoingecko: toCents(cg.bitcoin.usd),
		btcUsdCentsCoinbase: toCents(Number(cb.data.amount)),
		musdUsdMicros: toMicros(cg['mezo-usd'].usd),
	})
}

// ---------------------------------------------------------------- backtest (historical evidence)
async function rpcRaw(url: string, method: string, params: unknown[]) {
	const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'lifeline-sentinel/1.0' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })
	const j: any = await r.json()
	if (j.error) throw new Error(`${method}: ${j.error.message}`)
	return j.result
}

const ROUND_DATA_ABI = [{ type: 'function', name: 'getRoundData', stateMutability: 'view', inputs: [{ name: 'roundId', type: 'uint80' }], outputs: AGGREGATOR_V3_ABI[0].outputs }] as const

export async function gatherEvidenceAt(block: number): Promise<Evidence> {
	const mezoBlock = await rpcRaw(cfg.mezoRpc, 'eth_getBlockByNumber', [`0x${block.toString(16)}`, false])
	const t = Number(BigInt(mezoBlock.timestamp))
	const lensCode = await rpcRaw(cfg.mezoRpc, 'eth_getCode', [cfg.lens, 'latest'])
	const data = encodeFunctionData({ abi: LENS_ABI, functionName: 'snapshot', args: [cfg.vault, cfg.maxWalk, cfg.frontN] })
	const raw = await rpcRaw(cfg.mezoRpc, 'eth_call', [{ to: cfg.lens, data, gas: '0x1c9c380' }, `0x${block.toString(16)}`, { [cfg.lens]: { code: lensCode } }])
	const snap = decodeLensSnapshot(raw)
	// Chainlink: walk back from the latest round to the round that was current at time t
	const eth = createPublicClient({ transport: http(cfg.ethRpc) })
	let [rid, ans, , upd] = await eth.readContract({ address: CHAINLINK_BTC_USD_MAINNET, abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData' })
	for (let i = 0; upd > BigInt(t) && i < 500; i++) {
		;[rid, ans, , upd] = await eth.readContract({ address: CHAINLINK_BTC_USD_MAINNET, abi: ROUND_DATA_ABI, functionName: 'getRoundData', args: [rid - 1n] })
	}
	if (upd > BigInt(t)) throw new Error('could not find a Chainlink round before the block time')
	const cb = (await getJson(`https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=60&start=${t - 300}&end=${t}`)) as number[][]
	const candle = cb.filter((c) => c[0] <= t).sort((a, b) => b[0] - a[0])[0]
	const cgAt = async (id: string) => {
		const j = await getJson(`https://api.coingecko.com/api/v3/coins/${id}/market_chart/range?vs_currency=usd&from=${t - 900}&to=${t + 60}`)
		const pts = (j.prices as number[][]).filter((p) => p[0] / 1000 <= t)
		if (!pts.length) throw new Error(`no CoinGecko ${id} point before ${t}`)
		return pts[pts.length - 1][1]
	}
	return buildEvidence(t, snap, chainlinkRound(rid, ans, upd), {
		btcUsdCentsCoingecko: toCents(await cgAt('bitcoin')),
		btcUsdCentsCoinbase: toCents(candle[4]),
		musdUsdMicros: toMicros(await cgAt('mezo-usd')),
	})
}

function loadRelayerKey(): Hex {
	const f = process.env.DEPLOYER_WALLET ?? '/workspace/crypto-earn/wallet/mezo_testnet_deployer.json'
	const d = JSON.parse(readFileSync(f, 'utf8')).data
	const k = (Array.isArray(d) ? d[0] : d).private_key as string
	return (k.startsWith('0x') ? k : `0x${k}`) as Hex
}

async function relay(report: Hex) {
	const account = privateKeyToAccount(loadRelayerKey())
	const w = createWalletClient({ account, chain: mezoChain, transport: http(cfg.mezoRpc) })
	const p = createPublicClient({ chain: mezoChain, transport: http(cfg.mezoRpc) })
	// metadata is empty for the relayer path; the CRE KeystoneForwarder fills it with workflow id/owner.
	const hash = await w.writeContract({ address: cfg.decisionLog, abi: DECISION_LOG_ABI, functionName: 'onReport', args: ['0x', report], type: 'legacy' })
	const rc = await p.waitForTransactionReceipt({ hash })
	return { hash, status: rc.status, block: rc.blockNumber.toString(), gasUsed: rc.gasUsed.toString() }
}

function printDecision(d: ReturnType<typeof decide>) {
	console.log(`\n=== Lifeline Sentinel decision @ Mezo block ${d.mezoBlock} ===`)
	console.log(`vault ${d.vault}  ICR ${(d.icrBps / 100).toFixed(2)}%`)
	console.log(`\nBULL ${d.bull.score}`); for (const a of d.bull.arguments) console.log(`  +${a.points}  ${a.id}: ${a.claim}`)
	console.log(`BEAR ${d.bear.score}`); for (const a of d.bear.arguments) console.log(`  +${a.points}  ${a.id}: ${a.claim}`)
	console.log('\nJUDGE trail'); for (const s of d.trail) console.log(`  ${s.passed ? 'PASS' : 'FAIL'}  ${s.rule}: ${s.detail}`)
	console.log(`\n=> ${d.actionName}  (confidence ${(d.confidenceBps / 100).toFixed(1)}%)  practice: ${d.practiceName} ${d.practiceSize}`)
	console.log(`evidenceHash  ${d.evidenceHash}\npolicyHash    ${d.policyHash}\nreasoningHash ${d.reasoningHash}`)
}

export function replay(file: string) {
	const rec = JSON.parse(readFileSync(file, 'utf8'))
	const d = decide(rec.evidence)
	const checks = {
		evidenceHash: d.evidenceHash === rec.decision.evidenceHash,
		policyHash: d.policyHash === rec.decision.policyHash,
		reasoningHash: d.reasoningHash === rec.decision.reasoningHash,
		action: d.action === rec.decision.action,
		report: encodeReport(d) === rec.report,
	}
	return { ok: Object.values(checks).every(Boolean), checks, decision: d }
}

if (import.meta.main) {
	const args = process.argv.slice(2)
	if (args[0] === '--replay') {
		const r = replay(args[1])
		console.log(r.checks, r.ok ? 'REPLAY OK: same evidence + same policy => same decision' : 'REPLAY MISMATCH')
		process.exit(r.ok ? 0 : 1)
	}
	const at = args.indexOf('--at-block')
	if (at >= 0) {
		const block = Number(args[at + 1])
		const evidence = await gatherEvidenceAt(block)
		const decision = decide(evidence)
		printDecision(decision)
		const dir = ROOT + 'docs/backtest/'
		mkdirSync(dir, { recursive: true })
		const note = args[args.indexOf('--note') + 1] ?? ''
		writeFileSync(`${dir}${block}.json`, JSON.stringify({ reconstructed: true, note: args.includes('--note') ? note : '', evidence, decision, report: encodeReport(decision) }, null, 2))
		const idx = readdirSync(dir)
			.filter((f) => /^\d+\.json$/.test(f))
			.map((f) => {
				const r = JSON.parse(readFileSync(dir + f, 'utf8'))
				const d = r.decision
				return { block: Number(f.slice(0, -5)), observedAt: d.observedAt, action: d.actionName, practice: d.practiceName, icrBps: d.icrBps, bull: d.bull.score, bear: d.bear.score, note: r.note, evidenceHash: d.evidenceHash }
			})
			.sort((a, b) => a.block - b.block)
		writeFileSync(dir + 'index.json', JSON.stringify(idx, null, 2))
		console.log(`saved docs/backtest/${block}.json`)
		process.exit(0)
	}
	const evidence = await gatherEvidence()
	const decision = decide(evidence)
	const report = encodeReport(decision)
	printDecision(decision)
	let tx: Awaited<ReturnType<typeof relay>> | undefined
	if (args.includes('--relay')) {
		tx = await relay(report)
		console.log(`\nrelayed to DecisionLog ${cfg.decisionLog}: ${tx.hash} status=${tx.status} gas=${tx.gasUsed}`)
	}
	const dir = ROOT + 'docs/evidence/'
	mkdirSync(dir, { recursive: true })
	const rec = { evidence, decision, report, decisionLog: cfg.decisionLog, tx: tx ?? null }
	writeFileSync(`${dir}${decision.evidenceHash}.json`, JSON.stringify(rec, null, 2))
	const idxF = dir + 'index.json'
	const idx = existsSync(idxF) ? JSON.parse(readFileSync(idxF, 'utf8')) : []
	idx.unshift({ evidenceHash: decision.evidenceHash, observedAt: decision.observedAt, action: decision.actionName, tx: tx?.hash ?? null })
	writeFileSync(idxF, JSON.stringify(idx, null, 2))
	// also the exact canonical bytes that were hashed, so anyone can keccak them with any tool
	writeFileSync(`${dir}${decision.evidenceHash}.canonical.json`, canonicalize(evidence))
	console.log(`saved docs/evidence/${decision.evidenceHash}.json`)
}
