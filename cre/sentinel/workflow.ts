// Lifeline Sentinel: Chainlink CRE workflow.
//
// cron -> [HTTP] Mezo head (median) -> [HTTP] SentinelLens.snapshot at a pinned block (identical)
//      -> [EVM] Chainlink BTC/USD latestRoundData on Ethereum (DON read)
//      -> [HTTP] CoinGecko + Coinbase quotes (median)
//      -> deterministic bull / bear / judge (core/) -> signed report -> [EVM] DecisionLog.onReport (optional)
//
// Mezo is not (yet) a CRE-supported chain, so Mezo state is read through the HTTP capability as JSON-RPC
// eth_call pinned to one block number that the nodes first agree on. Every node then sees byte-identical
// evidence, so the deterministic judge produces byte-identical reports: consensus over the decision comes free.
import {
	bytesToHex,
	ConsensusAggregationByFields,
	type CronPayload,
	cre,
	encodeCallMsg,
	getNetwork,
	type HTTPSendRequester,
	identical,
	LAST_FINALIZED_BLOCK_NUMBER,
	median,
	prepareReportRequest,
	type Runtime,
	TxStatus,
} from '@chainlink/cre-sdk'
import { decodeFunctionResult, encodeFunctionData, type Hex, zeroAddress } from 'viem'
import { z } from 'zod'
import {
	AGGREGATOR_V3_ABI,
	LENS_ABI,
	buildEvidence,
	chainlinkRound,
	decide,
	decodeLensSnapshot,
	encodeReport,
	type Decision,
	type Evidence,
} from './core'

export const configSchema = z.object({
	schedule: z.string(),
	mezo: z.object({
		rpcUrl: z.string(),
		chainId: z.number(),
		lens: z.string(),
		vault: z.string(),
		confirmations: z.number().int().min(0),
		maxWalk: z.number().int().positive(),
		frontN: z.number().int().min(0),
	}),
	chainlink: z.object({ chainSelectorName: z.string(), btcUsdFeed: z.string() }),
	market: z.object({ coingeckoUrl: z.string(), coinbaseUrl: z.string() }),
	// Optional on-chain sink on a CRE-supported chain (KeystoneForwarder -> DecisionLog.onReport)
	write: z.object({ chainSelectorName: z.string(), decisionLog: z.string(), gasLimit: z.string() }).optional(),
})
export type Config = z.infer<typeof configSchema>

// ---------------------------------------------------------------- node-mode fetchers (run on every node)
const rpcBody = (method: string, params: unknown[]) =>
	Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })).toString('base64')

const rpc = (s: HTTPSendRequester, url: string, method: string, params: unknown[]): any => {
	const res = s
		.sendRequest({ url, method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'lifeline-sentinel-cre/1.0' }, body: rpcBody(method, params) })
		.result()
	if (res.statusCode !== 200) throw new Error(`${method}: HTTP ${res.statusCode}`)
	const j = JSON.parse(Buffer.from(res.body).toString('utf-8'))
	if (j.error) throw new Error(`${method}: ${j.error.message}`)
	return j.result
}

type Head = { block: number }
export const fetchMezoHead = (s: HTTPSendRequester, config: Config): Head => ({
	block: Number(BigInt(rpc(s, config.mezo.rpcUrl, 'eth_blockNumber', []))),
})

type LensRaw = { data: string }
export const fetchLensSnapshot = (s: HTTPSendRequester, config: Config, block: number): LensRaw => {
	const data = encodeFunctionData({
		abi: LENS_ABI,
		functionName: 'snapshot',
		args: [config.mezo.vault as Hex, BigInt(config.mezo.maxWalk), BigInt(config.mezo.frontN)],
	})
	const out = rpc(s, config.mezo.rpcUrl, 'eth_call', [{ to: config.mezo.lens, data, gas: '0x1c9c380' }, `0x${block.toString(16)}`])
	return { data: (out as string).toLowerCase() }
}

type Quotes = { btcCg: number; btcCb: number; musd: number }
export const fetchQuotes = (s: HTTPSendRequester, config: Config): Quotes => {
	const get = (url: string) => {
		const r = s.sendRequest({ url, method: 'GET', headers: { accept: 'application/json', 'user-agent': 'lifeline-sentinel-cre/1.0' } }).result()
		if (r.statusCode !== 200) throw new Error(`${url}: HTTP ${r.statusCode}`)
		return JSON.parse(Buffer.from(r.body).toString('utf-8'))
	}
	const cg = get(config.market.coingeckoUrl)
	const cb = get(config.market.coinbaseUrl)
	// integers only (cents / micro-dollars) so median and the evidence hash never touch floats
	return {
		btcCg: Math.round(cg.bitcoin.usd * 100),
		btcCb: Math.round(Number(cb.data.amount) * 100),
		musd: Math.round(cg['mezo-usd'].usd * 1_000_000),
	}
}

// ---------------------------------------------------------------- DON-level steps
export function gatherEvidence(runtime: Runtime<Config>, observedAt: number): Evidence {
	const c = runtime.config
	const http = new cre.capabilities.HTTPClient()

	const head = http.sendRequest(runtime, fetchMezoHead, ConsensusAggregationByFields<Head>({ block: median }))(c).result()
	const pinned = head.block - c.mezo.confirmations
	runtime.log(`mezo head ${head.block} (median), pinned ${pinned}`)

	const lens = http
		.sendRequest(runtime, fetchLensSnapshot, ConsensusAggregationByFields<LensRaw>({ data: identical }))(c, pinned)
		.result()
	const mezo = decodeLensSnapshot(lens.data as Hex, c.mezo.chainId)

	const net = getNetwork({ chainFamily: 'evm', chainSelectorName: c.chainlink.chainSelectorName, isTestnet: false })
	if (!net) throw new Error(`unknown chain ${c.chainlink.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(net.chainSelector.selector)
	const r = evm
		.callContract(runtime, {
			call: encodeCallMsg({
				from: zeroAddress,
				to: c.chainlink.btcUsdFeed as Hex,
				data: encodeFunctionData({ abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData' }),
			}),
			blockNumber: LAST_FINALIZED_BLOCK_NUMBER,
		})
		.result()
	const [roundId, answer, , updatedAt] = decodeFunctionResult({ abi: AGGREGATOR_V3_ABI, functionName: 'latestRoundData', data: bytesToHex(r.data) })

	const q = http
		.sendRequest(runtime, fetchQuotes, ConsensusAggregationByFields<Quotes>({ btcCg: median, btcCb: median, musd: median }))(c)
		.result()

	return buildEvidence(observedAt, mezo, chainlinkRound(roundId, answer, updatedAt), {
		btcUsdCentsCoingecko: String(q.btcCg),
		btcUsdCentsCoinbase: String(q.btcCb),
		musdUsdMicros: String(q.musd),
	})
}

export function publish(runtime: Runtime<Config>, d: Decision): string | undefined {
	const w = runtime.config.write
	const report = runtime.report(prepareReportRequest(encodeReport(d))).result()
	if (!w) {
		runtime.log('no write target configured: signed report produced, not submitted')
		return undefined
	}
	const net = getNetwork({ chainFamily: 'evm', chainSelectorName: w.chainSelectorName })
	if (!net) throw new Error(`unknown chain ${w.chainSelectorName}`)
	const evm = new cre.capabilities.EVMClient(net.chainSelector.selector)
	const res = evm.writeReport(runtime, { receiver: w.decisionLog, report, gasConfig: { gasLimit: w.gasLimit } }).result()
	if (res.txStatus !== TxStatus.SUCCESS) throw new Error(`writeReport failed: ${res.errorMessage || res.txStatus}`)
	const tx = bytesToHex(res.txHash || new Uint8Array(32))
	runtime.log(`DecisionLog.onReport tx ${tx}`)
	return tx
}

export const onCron = (runtime: Runtime<Config>, payload: CronPayload): string => {
	if (!payload.scheduledExecutionTime) throw new Error('scheduledExecutionTime is required')
	// observedAt is the DON-agreed schedule time, never a node's local clock
	const observedAt = Number(payload.scheduledExecutionTime.seconds)
	const evidence = gatherEvidence(runtime, observedAt)
	const d = decide(evidence)
	runtime.log(`bull ${d.bull.score} [${d.bull.arguments.map((a) => a.id).join(',')}]`)
	runtime.log(`bear ${d.bear.score} [${d.bear.arguments.map((a) => a.id).join(',')}]`)
	for (const s of d.trail) runtime.log(`judge ${s.passed ? 'PASS' : 'FAIL'} ${s.rule}: ${s.detail}`)
	runtime.log(`decision ${d.actionName} conf=${d.confidenceBps} practice=${d.practiceName} evidence=${d.evidenceHash} policy=${d.policyHash}`)
	const tx = publish(runtime, d)
	return JSON.stringify({
		action: d.actionName,
		practice: d.practiceName,
		icrBps: d.icrBps,
		bull: d.bull.score,
		bear: d.bear.score,
		evidenceHash: d.evidenceHash,
		policyHash: d.policyHash,
		reasoningHash: d.reasoningHash,
		tx: tx ?? null,
	})
}

export function initWorkflow(config: Config) {
	const cron = new cre.capabilities.CronCapability()
	return [cre.handler(cron.trigger({ schedule: config.schedule }), onCron)]
}
