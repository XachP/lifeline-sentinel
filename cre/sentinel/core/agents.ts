// Two adversarial agents argue from the SAME evidence. Each argument names the evidence fields it relies on,
// so a reviewer can check every claim against the evidence record. Deterministic by design: no LLM in the
// decision path, so the trail is replayable byte-for-byte.
import type { Evidence } from './evidence'
import { metrics, musdFmt, pct, usd, type Metrics } from './metrics'
import type { Policy } from './policy'

export type Argument = { id: string; claim: string; points: number; evidence: string[] }
export type AgentCase = { agent: 'bull' | 'bear'; score: number; arguments: Argument[] }

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))
const total = (args: Argument[]) => args.reduce((s, a) => s + a.points, 0)

/** Bull: argues the position is safe and nothing intrusive should happen. */
export function bullCase(e: Evidence, p: Policy, m: Metrics = metrics(e, p)): AgentCase {
	const a: Argument[] = []
	if (m.headroomBps >= p.risk.icrWatchBufferBps)
		a.push({
			id: 'B1_icr_headroom',
			claim: `ICR ${pct(m.icrBps)} is ${pct(m.headroomBps)} above the ${pct(m.triggerBps)} trigger.`,
			points: clamp(Math.floor(m.headroomBps / 5), 0, 300),
			evidence: ['mezo.icrE18', 'mezo.triggerE18'],
		})
	if (m.debtAheadMusd >= m.redemptionBufferMusd * p.risk.comfortableQueueMultiple)
		a.push({
			id: 'B2_deep_queue',
			claim: `${musdFmt(m.debtAheadMusd)} of other debt (rank ${m.rankFromFront} of ${m.queueSize}) would be redeemed before this trove: ${Math.floor(m.debtAheadMusd / m.redemptionBufferMusd)}x the buffer.`,
			points: 150,
			evidence: ['mezo.debtAheadWei', 'mezo.rankFromFront', 'mezo.queueSize'],
		})
	if (m.liquidationGapBps >= p.risk.liquidationGapWatchBps)
		a.push({
			id: 'B3_liquidation_far',
			claim: `BTC would have to fall ${pct(m.liquidationGapBps)} before this trove could be liquidated.`,
			points: 150,
			evidence: ['mezo.priceE18', 'mezo.liquidationPriceE18'],
		})
	if (m.reserveFunded)
		a.push({
			id: 'B4_rescue_prefunded',
			claim: 'The vault holds a rescue reserve, so a protect() call can lift the trove without the owner online.',
			points: 100,
			evidence: ['mezo.reserveBtcWei', 'mezo.reserveMusdWei'],
		})
	if (!e.mezo.recoveryMode && m.tcrBps >= Number(BigInt(p.risk.healthyTcrE18) / 10n ** 14n))
		a.push({
			id: 'B5_system_healthy',
			claim: `System TCR ${pct(m.tcrBps)} and no Recovery Mode: the 110% line applies, not 150%.`,
			points: 50,
			evidence: ['mezo.tcrE18', 'mezo.recoveryMode'],
		})
	if (m.oracleDeviationBps <= p.dataQuality.maxOracleDeviationBps / 2 && m.cexDeviationBps <= p.dataQuality.maxCexDeviationBps / 2)
		a.push({
			id: 'B6_prices_agree',
			claim: `Mezo oracle ${usd(m.mezoPriceCents)} and Chainlink ${usd(m.chainlinkCents)} agree within ${pct(m.oracleDeviationBps)}.`,
			points: 50,
			evidence: ['mezo.priceE18', 'chainlink.answerE8', 'market.btcUsdCentsCoingecko', 'market.btcUsdCentsCoinbase'],
		})
	if (m.musdMicros <= p.practice.arbMaxMusdMicros && m.arbEdgeBps >= p.practice.minArbEdgeBps)
		a.push({
			id: 'B7_redemption_arb_edge',
			claim: `MUSD trades at $${(m.musdMicros / 1e6).toFixed(4)}: redeeming at face value nets about ${pct(m.arbEdgeBps)} after an assumed ${pct(p.practice.assumedRedemptionFeeBps)} fee.`,
			points: 120,
			evidence: ['market.musdUsdMicros'],
		})
	return { agent: 'bull', score: total(a), arguments: a }
}

/** Bear: argues the position is at risk and something should be done. */
export function bearCase(e: Evidence, p: Policy, m: Metrics = metrics(e, p)): AgentCase {
	const a: Argument[] = []
	if (m.headroomBps < 0)
		a.push({ id: 'R1_below_trigger', claim: `ICR ${pct(m.icrBps)} is BELOW the ${pct(m.triggerBps)} trigger.`, points: 400, evidence: ['mezo.icrE18', 'mezo.triggerE18'] })
	else if (m.headroomBps < p.risk.icrWatchBufferBps)
		a.push({
			id: 'R1_near_trigger',
			claim: `Only ${pct(m.headroomBps)} of ICR headroom above the trigger.`,
			points: clamp(Math.floor((p.risk.icrWatchBufferBps - m.headroomBps) / 5), 0, 300),
			evidence: ['mezo.icrE18', 'mezo.triggerE18'],
		})
	if (e.mezo.redemptionRisk)
		a.push({ id: 'R2_redemption_risk', claim: 'The vault itself flags redemption risk: too little debt is ahead of it in the queue.', points: 400, evidence: ['mezo.redemptionRisk', 'mezo.redemptionSafeIcrE18'] })
	else if (m.debtAheadMusd < m.redemptionBufferMusd)
		a.push({
			id: 'R2_thin_queue',
			claim: `Only ${musdFmt(m.debtAheadMusd)} ahead in the redemption queue, under the ${musdFmt(m.redemptionBufferMusd)} buffer.`,
			points: 300,
			evidence: ['mezo.debtAheadWei'],
		})
	if (m.liquidationGapBps < p.risk.liquidationGapWatchBps)
		a.push({ id: 'R3_liquidation_close', claim: `A ${pct(m.liquidationGapBps)} BTC drop would liquidate this trove.`, points: 200, evidence: ['mezo.priceE18', 'mezo.liquidationPriceE18'] })
	if (e.mezo.recoveryMode)
		a.push({ id: 'R4_recovery_mode', claim: 'System is in Recovery Mode: troves under 150% can be liquidated.', points: 250, evidence: ['mezo.recoveryMode', 'mezo.tcrE18'] })
	if (!m.reserveFunded)
		a.push({ id: 'R5_no_reserve', claim: 'The rescue reserve is empty: no keeper can protect this trove.', points: 150, evidence: ['mezo.reserveBtcWei', 'mezo.reserveMusdWei'] })
	if (m.oracleDeviationBps > p.dataQuality.maxOracleDeviationBps / 2)
		a.push({
			id: 'R6_oracle_divergence',
			claim: `Mezo oracle ${usd(m.mezoPriceCents)} is ${pct(m.oracleDeviationBps)} away from Chainlink ${usd(m.chainlinkCents)}.`,
			points: 100,
			evidence: ['mezo.priceE18', 'chainlink.answerE8'],
		})
	if (m.chainlinkAgeSec > p.dataQuality.maxChainlinkAgeSec / 2)
		a.push({ id: 'R7_stale_reference', claim: `Chainlink round is ${m.chainlinkAgeSec}s old.`, points: 50, evidence: ['chainlink.updatedAt'] })
	if (m.musdMicros < 1_000_000 - 5_000)
		a.push({
			id: 'R8_peg_pressure',
			claim: `MUSD below peg ($${(m.musdMicros / 1e6).toFixed(4)}) makes redemptions profitable, so redemption pressure on the front of the queue rises.`,
			points: 60,
			evidence: ['market.musdUsdMicros', 'mezo.front'],
		})
	return { agent: 'bear', score: total(a), arguments: a }
}
