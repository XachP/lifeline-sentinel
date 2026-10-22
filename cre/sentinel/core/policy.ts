// Policy v1: the rules the agents and the judge are bound by. Its keccak256 (of canonical JSON) must be
// registered in DecisionLog before any decision made under it is accepted on-chain. Changing ANY number
// here changes the hash, so a silently edited rulebook cannot log decisions.
import { hashCanonical } from './canonical'

export const POLICY_V1 = {
	id: 'lifeline-sentinel/policy/v1',
	description:
		'Duty-of-care policy for automated management of one Lifeline-protected MUSD trove on Mezo. Hard safety rules first, then a bull/bear weighing with a fixed margin. Practice trades are records only.',
	dataQuality: {
		maxOracleDeviationBps: 200, // Mezo oracle vs Chainlink BTC/USD
		maxCexDeviationBps: 150, // CoinGecko vs Coinbase BTC/USD
		maxChainlinkAgeSec: 7200,
		maxSnapshotLagSec: 900, // observedAt - Mezo block time
		requireQueueWalkComplete: true,
	},
	risk: {
		icrWatchBufferBps: 1000, // within 10 ICR points of the trigger = bear territory
		liquidationGapWatchBps: 2500, // BTC can fall < 25% before liquidation = bear territory
		redemptionBufferMusd: '25000000000000000000000', // 25,000 MUSD of other debt ahead of us
		comfortableQueueMultiple: 4, // >= 4x the buffer ahead of us = bull territory
		healthyTcrE18: '1500000000000000000', // 150%
	},
	judge: {
		watchMarginPoints: 150, // bear - bull >= 150 => WATCH
		hedgeMarginPoints: 300, // bear - bull >= 300 => practice hedge
	},
	practice: {
		arbMaxMusdMicros: 990000, // MUSD at or below $0.99
		assumedRedemptionFeeBps: 75, // conservative assumption; real fee varies with redemption volume
		minArbEdgeBps: 25,
		arbSizeMusd: '2000000000000000000000', // 2,000 MUSD practice ticket
		hedgeFractionBps: 5000, // hedge half the trove collateral
	},
} as const

export type Policy = typeof POLICY_V1
export const policyHash = (p: Policy = POLICY_V1) => hashCanonical(p)
