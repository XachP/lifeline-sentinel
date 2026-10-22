import { describe, expect, test } from 'bun:test'
import { keccak256, stringToBytes } from 'viem'
import live from './fixtures/live-2026-10-21.json'
import { Action, POLICY_V1, Practice, canonicalize, decide, decodeReport, encodeReport, evidenceHash, hashCanonical, policyHash, type Evidence, type Policy } from '../core'
import { replay } from '../cli'

const base = live.evidence as Evidence
const clone = (): Evidence => structuredClone(base)
const with_ = (f: (e: Evidence) => void) => { const e = clone(); f(e); return e }
const E18 = 10n ** 18n

describe('canonical JSON', () => {
	test('sorts keys recursively, no whitespace', () => {
		expect(canonicalize({ b: 1, a: { d: [2, { z: true, y: null }], c: 'x' } })).toBe('{"a":{"c":"x","d":[2,{"y":null,"z":true}]},"b":1}')
	})
	test('key order does not change the hash', () => {
		expect(hashCanonical({ a: 1, b: 2 })).toBe(hashCanonical({ b: 2, a: 1 }))
	})
	test('bigints become decimal strings', () => {
		expect(canonicalize({ x: 10n ** 30n })).toBe('{"x":"1000000000000000000000000000000"}')
	})
	test('rejects floats so no node can disagree on rounding', () => {
		expect(() => canonicalize({ p: 0.1 })).toThrow()
	})
	test('hash = keccak256 of the published canonical bytes', () => {
		expect(evidenceHash(base)).toBe(keccak256(stringToBytes(canonicalize(base))))
	})
})

describe('policy', () => {
	test('v1 hash is pinned (matches the hash registered on Mezo testnet)', () => {
		expect(policyHash()).toBe('0x57065b3444adb76b5fbdc26e209f2d89ec531bdce8a189657e6ddfc527304b89')
	})
	test('editing any threshold changes the hash', () => {
		const p = structuredClone(POLICY_V1) as any
		p.judge.watchMarginPoints = 151
		expect(policyHash(p)).not.toBe(policyHash())
	})
})

describe('live snapshot (Mezo block 16291108)', () => {
	const d = decide(base)
	test('decision is HOLD with a redemption-arb practice trade', () => {
		expect(d.action).toBe(Action.HOLD)
		expect(d.practice).toBe(Practice.REDEMPTION_ARB)
		expect(d.icrBps).toBe(14754)
	})
	test('replays byte-for-byte from the saved record', () => {
		expect(d.evidenceHash).toBe(live.decision.evidenceHash as any)
		expect(d.reasoningHash).toBe(live.decision.reasoningHash as any)
		expect(encodeReport(d)).toBe(live.report as any)
	})
	test('replay() verifies a saved file', () => {
		expect(replay(new URL('./fixtures/live-2026-10-21.json', import.meta.url).pathname).ok).toBe(true)
	})
	test('every argument cites evidence that exists', () => {
		const get = (path: string) => path.split('.').reduce((o: any, k) => o?.[k], base)
		for (const a of [...d.bull.arguments, ...d.bear.arguments]) for (const p of a.evidence) expect(get(p)).toBeDefined()
	})
	test('scores equal the sum of argument points', () => {
		for (const c of [d.bull, d.bear]) expect(c.score).toBe(c.arguments.reduce((s, a) => s + a.points, 0))
	})
	test('deterministic: 50 runs, one answer', () => {
		const h = new Set(Array.from({ length: 50 }, () => decide(clone()).reasoningHash))
		expect(h.size).toBe(1)
	})
})

describe('judge rules', () => {
	test('needsProtection + funded reserve => PROTECT (hard rule beats the bull)', () => {
		const d = decide(with_((e) => { e.mezo.needsProtection = true }))
		expect(d.action).toBe(Action.PROTECT)
		expect(d.confidenceBps).toBe(10000)
	})
	test('needsProtection + empty reserve => ESCALATE', () => {
		const d = decide(with_((e) => { e.mezo.needsProtection = true; e.mezo.reserveBtcWei = '0'; e.mezo.reserveMusdWei = '0' }))
		expect(d.action).toBe(Action.ESCALATE)
	})
	test('oracle divergence beyond 2% => ABSTAIN, no practice trade', () => {
		const d = decide(with_((e) => { e.chainlink.answerE8 = ((BigInt(e.chainlink.answerE8) * 103n) / 100n).toString() }))
		expect(d.action).toBe(Action.ABSTAIN)
		expect(d.practice).toBe(Practice.NONE)
		expect(d.trail.find((s) => s.rule === 'Q2_oracle_agreement')!.passed).toBe(false)
	})
	test('stale Chainlink round => ABSTAIN', () => {
		expect(decide(with_((e) => { e.chainlink.updatedAt = String(e.observedAt - 7201) })).action).toBe(Action.ABSTAIN)
	})
	test('incomplete queue walk => ABSTAIN', () => {
		expect(decide(with_((e) => { e.mezo.walkComplete = false })).action).toBe(Action.ABSTAIN)
	})
	test('closed trove => ABSTAIN', () => {
		expect(decide(with_((e) => { e.mezo.troveStatus = 2 })).action).toBe(Action.ABSTAIN)
	})
	test('thin queue + near trigger + recovery mode => WATCH and HEDGE', () => {
		const d = decide(with_((e) => {
			e.mezo.debtAheadWei = (1000n * E18).toString()
			e.mezo.redemptionRisk = true
			e.mezo.recoveryMode = true
			e.mezo.icrE18 = ((141n * E18) / 100n).toString()
			e.market.musdUsdMicros = '1000000'
		}))
		expect(d.bear.score - d.bull.score).toBeGreaterThanOrEqual(POLICY_V1.judge.watchMarginPoints)
		expect(d.action).toBe(Action.WATCH)
		expect(d.practice).toBe(Practice.HEDGE)
		expect(BigInt(d.practiceSize)).toBe(BigInt(base.mezo.collWei) / 2n)
	})
	test('MUSD at peg => no arb', () => {
		expect(decide(with_((e) => { e.market.musdUsdMicros = '999000' })).practice).toBe(Practice.NONE)
	})
	test('a stricter policy can change the outcome, and the policy hash records which one applied', () => {
		const strict = structuredClone(POLICY_V1) as any as Policy
		;(strict as any).judge.watchMarginPoints = -10000
		const d = decide(base, strict)
		expect(d.action).toBe(Action.WATCH)
		expect(d.policyHash).not.toBe(policyHash())
	})
})

describe('report encoding', () => {
	test('13 words, round-trips', () => {
		const d = decide(base)
		const r = encodeReport(d)
		expect((r.length - 2) / 2).toBe(13 * 32)
		const x = decodeReport(r)
		expect(Number(x[0])).toBe(d.observedAt)
		expect(x[2].toLowerCase()).toBe(d.vault)
		expect(x[3]).toBe(d.action)
		expect(x[10]).toBe(d.evidenceHash)
		expect(x[11]).toBe(d.policyHash)
		expect(x[12]).toBe(d.reasoningHash)
	})
})

describe('backtest: the two real Lifeline rescues on Mezo testnet (Oct 21)', () => {
	const dir = new URL('../../../docs/backtest/', import.meta.url).pathname
	const load = (b: number) => require(`${dir}${b}.json`)
	test.each([
		[16289555, Action.PROTECT, 'redemption risk before the guard lift'],
		[16289557, Action.HOLD, 'after the guard lift'],
		[16289564, Action.PROTECT, 'ICR below the 140% trigger before the rescue'],
		[16289566, Action.HOLD, 'after the rescue restored 150%'],
	])('block %d => %s (%s)', (block, action) => {
		const rec = load(block as number)
		const d = decide(rec.evidence)
		expect(d.action).toBe(action as Action)
		expect(d.evidenceHash).toBe(rec.decision.evidenceHash)
		expect(d.reasoningHash).toBe(rec.decision.reasoningHash)
	})
})
