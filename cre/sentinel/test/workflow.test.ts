// Runs the real CRE handler against the SDK's capability mocks (HTTP + EVM), fed with the exact bytes
// recorded from Mezo testnet / Ethereum / CoinGecko / Coinbase. It must reproduce the CLI's decision bit-for-bit.
import { describe, expect } from 'bun:test'
import { TxStatus } from '@chainlink/cre-sdk'
import { EvmMock, HttpActionsMock, newTestRuntime, test } from '@chainlink/cre-sdk/test'
import { decodeFunctionData, encodeFunctionResult, type Hex } from 'viem'
import live from './fixtures/live-2026-10-21.json'
import lensRaw from './fixtures/lens-raw-16291108.json'
import cfgJson from '../config.staging.json'
import { AGGREGATOR_V3_ABI, decodeReport } from '../core'
import { initWorkflow, onCron, type Config } from '../workflow'

const ETH_MAINNET = 5009297550715157269n
const SEPOLIA = 16015286601757825753n
const ev = live.evidence
const b64 = (s: string) => Buffer.from(s).toString('base64')
const json = (o: unknown) => ({ statusCode: 200, body: b64(JSON.stringify(o)) })

type Seen = { methods: string[]; callBlock?: string }

function wireMocks(seen: Seen, opts: { lensData?: string } = {}) {
	const http = HttpActionsMock.testInstance()
	http.sendRequest = (req: any) => {
		const url: string = req.url
		if (url.startsWith('https://rpc.test.mezo.org')) {
			const body = JSON.parse(Buffer.from(req.body).toString('utf-8'))
			seen.methods.push(body.method)
			if (body.method === 'eth_blockNumber') return json({ jsonrpc: '2.0', id: 1, result: `0x${(lensRaw.block + 2).toString(16)}` })
			if (body.method === 'eth_call') {
				seen.callBlock = body.params[1]
				return json({ jsonrpc: '2.0', id: 1, result: opts.lensData ?? lensRaw.data })
			}
		}
		if (url.includes('coingecko')) return json({ bitcoin: { usd: Number(ev.market.btcUsdCentsCoingecko) / 100 }, 'mezo-usd': { usd: Number(ev.market.musdUsdMicros) / 1e6 } })
		if (url.includes('coinbase')) return json({ data: { amount: (Number(ev.market.btcUsdCentsCoinbase) / 100).toFixed(2), base: 'BTC', currency: 'USD' } })
		throw new Error(`unexpected request ${url}`)
	}
	const evm = EvmMock.testInstance(ETH_MAINNET)
	evm.callContract = () => ({
		data: b64Hex(
			encodeFunctionResult({
				abi: AGGREGATOR_V3_ABI,
				functionName: 'latestRoundData',
				result: [BigInt(ev.chainlink.roundId), BigInt(ev.chainlink.answerE8), BigInt(ev.chainlink.updatedAt), BigInt(ev.chainlink.updatedAt), BigInt(ev.chainlink.roundId)],
			}),
		),
	})
	return { http, evm }
}
const b64Hex = (h: Hex) => Buffer.from(h.slice(2), 'hex').toString('base64')

const run = (config: Config) => {
	const runtime = newTestRuntime() as any
	runtime.config = config
	return JSON.parse(onCron(runtime, { scheduledExecutionTime: { seconds: BigInt(ev.observedAt), nanos: 0 } } as any))
}

describe('CRE workflow (SDK mocks, recorded live data)', () => {
	test('reproduces the CLI decision byte-for-byte', () => {
		const seen: Seen = { methods: [] }
		wireMocks(seen)
		const out = run(cfgJson as Config)
		expect(seen.methods).toEqual(['eth_blockNumber', 'eth_call'])
		expect(seen.callBlock).toBe(`0x${lensRaw.block.toString(16)}`) // pinned = head - confirmations
		expect(out.action).toBe('HOLD')
		expect(out.practice).toBe('REDEMPTION_ARB')
		expect(out.evidenceHash).toBe(live.decision.evidenceHash)
		expect(out.reasoningHash).toBe(live.decision.reasoningHash)
		expect(out.policyHash).toBe(live.decision.policyHash)
		expect(out.tx).toBeNull()
	})

	test('writes the 13-word report to DecisionLog when a write target is configured', () => {
		const seen: Seen = { methods: [] }
		wireMocks(seen)
		const sink = EvmMock.testInstance(SEPOLIA)
		let receiver = ''
		let payload: Hex = '0x'
		sink.writeReport = (req: any) => {
			receiver = typeof req.receiver === 'string' ? req.receiver : `0x${Buffer.from(req.receiver).toString('hex')}`
			const raw = req.report?.rawReport
			payload = typeof raw === 'string' ? (`0x${Buffer.from(raw, 'base64').toString('hex')}` as Hex) : (`0x${Buffer.from(raw ?? []).toString('hex')}` as Hex)
			return { txStatus: TxStatus.SUCCESS, txHash: b64('x'.repeat(32)) }
		}
		const cfg: Config = { ...(cfgJson as Config), write: { chainSelectorName: 'ethereum-testnet-sepolia', decisionLog: '0x8ACFA64297Cd64590ff9D18067cdb475A65a3880', gasLimit: '400000' } }
		const out = run(cfg)
		expect(out.tx).toMatch(/^0x[0-9a-f]{64}$/)
		expect(receiver.toLowerCase()).toContain('8acfa64297cd64590ff9d18067cdb475a65a3880')
		// the signed report carries our 13-word payload (test runtime may wrap it with metadata)
		expect(payload.toLowerCase()).toContain(live.report.slice(2).toLowerCase())
	})

	test('a mismatching Mezo snapshot changes the evidence hash (no silent substitution)', () => {
		const seen: Seen = { methods: [] }
		const tampered = lensRaw.data.replace(/.$/, (c: string) => (c === '0' ? '1' : '0'))
		wireMocks(seen, { lensData: tampered })
		let out: any
		try { out = run(cfgJson as Config) } catch { out = { evidenceHash: 'decode-failed' } }
		expect(out.evidenceHash).not.toBe(live.decision.evidenceHash)
	})

	test('requires the cron schedule time', () => {
		const runtime = newTestRuntime() as any
		runtime.config = cfgJson
		expect(() => onCron(runtime, {} as any)).toThrow('scheduledExecutionTime')
	})
})

describe('initWorkflow', () => {
	test('one cron handler on the configured schedule', () => {
		const h = initWorkflow(cfgJson as Config)
		expect(h).toHaveLength(1)
		expect(h[0].fn).toBe(onCron)
		expect((h[0].trigger as any).config?.schedule).toBe(cfgJson.schedule)
	})
})
