// The judge: a fixed, ordered rule list. The first matching rule decides. It never "weighs vibes":
// hard safety rules come before any score comparison, and every step it took is recorded in the trail.
import { bearCase, bullCase, type AgentCase } from './agents'
import { hashCanonical } from './canonical'
import { evidenceHash, type Evidence } from './evidence'
import { metrics, type Metrics } from './metrics'
import { POLICY_V1, policyHash, type Policy } from './policy'

export enum Action { HOLD = 0, WATCH = 1, PROTECT = 2, ESCALATE = 3, ABSTAIN = 4 }
export enum Practice { NONE = 0, REDEMPTION_ARB = 1, HEDGE = 2 }

export type TrailStep = { rule: string; passed: boolean; detail: string }

export type Decision = {
	observedAt: number
	mezoBlock: string
	vault: string
	action: Action
	actionName: keyof typeof Action
	practice: Practice
	practiceName: keyof typeof Practice
	practiceSize: string // MUSD wei for REDEMPTION_ARB, BTC wei for HEDGE
	confidenceBps: number
	icrBps: number
	bull: AgentCase
	bear: AgentCase
	trail: TrailStep[]
	metrics: Metrics
	evidenceHash: `0x${string}`
	policyHash: `0x${string}`
	reasoningHash: `0x${string}`
}

export function decide(e: Evidence, p: Policy = POLICY_V1): Decision {
	const m = metrics(e, p)
	const bull = bullCase(e, p, m)
	const bear = bearCase(e, p, m)
	const net = bear.score - bull.score
	const q = p.dataQuality
	const trail: TrailStep[] = []
	const step = (rule: string, passed: boolean, detail: string) => (trail.push({ rule, passed, detail }), passed)

	let action: Action | undefined
	let confidence = 10000

	// Rule 0: data quality. Acting on bad data is the classic breach of duty, so we abstain instead.
	const gates = [
		step('Q1_trove_active', e.mezo.troveStatus === 1, `troveStatus=${e.mezo.troveStatus} (1 = active)`),
		step('Q2_oracle_agreement', m.oracleDeviationBps <= q.maxOracleDeviationBps, `mezo vs chainlink ${m.oracleDeviationBps} bps <= ${q.maxOracleDeviationBps}`),
		step('Q3_cex_agreement', m.cexDeviationBps <= q.maxCexDeviationBps, `coingecko vs coinbase ${m.cexDeviationBps} bps <= ${q.maxCexDeviationBps}`),
		step('Q4_chainlink_fresh', m.chainlinkAgeSec >= 0 && m.chainlinkAgeSec <= q.maxChainlinkAgeSec, `age ${m.chainlinkAgeSec}s <= ${q.maxChainlinkAgeSec}s`),
		step('Q5_snapshot_fresh', m.snapshotLagSec >= -60 && m.snapshotLagSec <= q.maxSnapshotLagSec, `lag ${m.snapshotLagSec}s <= ${q.maxSnapshotLagSec}s`),
		step('Q6_queue_walk_complete', !q.requireQueueWalkComplete || e.mezo.walkComplete, `walkComplete=${e.mezo.walkComplete}`),
	]
	if (gates.some((g) => !g)) action = Action.ABSTAIN

	// Rule 1: the vault's own on-chain safety flag is binding.
	if (action === undefined && step('R1_needs_protection', e.mezo.needsProtection, `vault.needsProtection=${e.mezo.needsProtection}`)) {
		action = m.reserveFunded ? Action.PROTECT : Action.ESCALATE
		step('R1a_reserve_funded', m.reserveFunded, m.reserveFunded ? 'reserve available -> PROTECT' : 'reserve empty -> ESCALATE to owner')
	}

	// Rule 2: the bear must beat the bull by a fixed margin to move to WATCH.
	if (action === undefined) {
		if (step('R2_bear_margin', net >= p.judge.watchMarginPoints, `bear ${bear.score} - bull ${bull.score} = ${net} >= ${p.judge.watchMarginPoints}`)) action = Action.WATCH
		else {
			action = Action.HOLD
			step('R3_default_hold', true, 'no rule requires action')
		}
		confidence = Math.min(10000, 5000 + Math.abs(net) * 10)
	}

	// Practice trade (recorded, never executed): only when we are not abstaining.
	let practice = Practice.NONE
	let practiceSize = 0n
	if (action !== Action.ABSTAIN) {
		if (m.musdMicros <= p.practice.arbMaxMusdMicros && m.arbEdgeBps >= p.practice.minArbEdgeBps) {
			practice = Practice.REDEMPTION_ARB
			practiceSize = BigInt(p.practice.arbSizeMusd)
			step('P1_redemption_arb', true, `edge ${m.arbEdgeBps} bps >= ${p.practice.minArbEdgeBps}: buy ${BigInt(p.practice.arbSizeMusd) / 10n ** 18n} MUSD, redeem at $1`)
		} else if (net >= p.judge.hedgeMarginPoints) {
			practice = Practice.HEDGE
			practiceSize = (BigInt(e.mezo.collWei) * BigInt(p.practice.hedgeFractionBps)) / 10000n
			step('P2_hedge', true, `net ${net} >= ${p.judge.hedgeMarginPoints}: short ${p.practice.hedgeFractionBps / 100}% of collateral`)
		} else step('P0_no_trade', true, 'no practice-trade condition met')
	}

	const pHash = policyHash(p)
	const eHash = evidenceHash(e)
	const reasoningHash = hashCanonical({ bull, bear, trail, evidenceHash: eHash, policyHash: pHash })
	return {
		observedAt: e.observedAt,
		mezoBlock: e.mezo.block,
		vault: e.mezo.vault,
		action,
		actionName: Action[action] as keyof typeof Action,
		practice,
		practiceName: Practice[practice] as keyof typeof Practice,
		practiceSize: practiceSize.toString(),
		confidenceBps: confidence,
		icrBps: m.icrBps,
		bull,
		bear,
		trail,
		metrics: m,
		evidenceHash: eHash,
		policyHash: pHash,
		reasoningHash,
	}
}
