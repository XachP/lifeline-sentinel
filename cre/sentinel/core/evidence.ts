// The evidence record: everything the agents are allowed to look at, and nothing else.
// Built identically by the CRE workflow (after node consensus), the local CLI, and the browser replay.
import { decodeFunctionResult, type Hex } from 'viem'
import { LENS_ABI, CHAINLINK_BTC_USD_MAINNET } from './abi'
import { hashCanonical } from './canonical'

export const EVIDENCE_SCHEMA = 'lifeline-sentinel/evidence/v1'

export type QueueEntry = { borrower: string; icrE18: string; debtWei: string }

export type MezoSnapshot = {
	chainId: number
	block: string
	blockTime: string
	vault: string
	vaultOwner: string
	troveStatus: number
	priceE18: string
	icrE18: string
	triggerE18: string
	targetE18: string
	recoveryMode: boolean
	needsProtection: boolean
	collWei: string
	debtWei: string
	reserveBtcWei: string
	reserveMusdWei: string
	liquidationPriceE18: string
	redemptionSafeIcrE18: string
	redemptionRisk: boolean
	tcrE18: string
	queueSize: string
	rankFromFront: string
	debtAheadWei: string
	walkComplete: boolean
	lifelineVaults: string
	front: QueueEntry[]
}

export type ChainlinkRound = {
	network: 'ethereum-mainnet'
	feed: string
	roundId: string
	answerE8: string
	updatedAt: string
}

export type MarketQuotes = {
	// medians across oracle nodes (CRE) or a single fetch (CLI); integers only
	btcUsdCentsCoingecko: string
	btcUsdCentsCoinbase: string
	musdUsdMicros: string // Mezo USD (MUSD) market price on mainnet, 1e6 = $1.00
}

export type Evidence = {
	schema: typeof EVIDENCE_SCHEMA
	observedAt: number
	mezo: MezoSnapshot
	chainlink: ChainlinkRound
	market: MarketQuotes
}

export function decodeLensSnapshot(data: Hex, chainId = 31611): MezoSnapshot {
	const s = decodeFunctionResult({ abi: LENS_ABI, functionName: 'snapshot', data }) as any
	const h = s.health
	return {
		chainId,
		block: s.blockNumber.toString(),
		blockTime: s.timestamp.toString(),
		vault: s.vault.toLowerCase(),
		vaultOwner: s.vaultOwner.toLowerCase(),
		troveStatus: Number(h.status),
		priceE18: h.price.toString(),
		icrE18: h.icr.toString(),
		triggerE18: h.trigger.toString(),
		targetE18: h.target.toString(),
		recoveryMode: h.recoveryMode,
		needsProtection: h.needsProtection,
		collWei: h.coll.toString(),
		debtWei: h.debt.toString(),
		reserveBtcWei: h.reserveBtc.toString(),
		reserveMusdWei: h.reserveMusd.toString(),
		liquidationPriceE18: h.liquidationPrice.toString(),
		redemptionSafeIcrE18: h.redemptionSafeICR.toString(),
		redemptionRisk: h.redemptionRisk,
		tcrE18: s.tcr.toString(),
		queueSize: s.queueSize.toString(),
		rankFromFront: s.rankFromFront.toString(),
		debtAheadWei: s.debtAhead.toString(),
		walkComplete: s.walkComplete,
		lifelineVaults: s.lifelineVaults.toString(),
		front: s.front.map((q: any) => ({ borrower: q.borrower.toLowerCase(), icrE18: q.icr.toString(), debtWei: q.debt.toString() })),
	}
}

export function chainlinkRound(roundId: bigint, answer: bigint, updatedAt: bigint): ChainlinkRound {
	return {
		network: 'ethereum-mainnet',
		feed: CHAINLINK_BTC_USD_MAINNET.toLowerCase(),
		roundId: roundId.toString(),
		answerE8: answer.toString(),
		updatedAt: updatedAt.toString(),
	}
}

export const toCents = (usd: number): string => Math.round(usd * 100).toString()
export const toMicros = (usd: number): string => Math.round(usd * 1_000_000).toString()

export function buildEvidence(observedAt: number, mezo: MezoSnapshot, chainlink: ChainlinkRound, market: MarketQuotes): Evidence {
	if (!Number.isSafeInteger(observedAt) || observedAt <= 0) throw new Error('observedAt must be unix seconds')
	return { schema: EVIDENCE_SCHEMA, observedAt, mezo, chainlink, market }
}

export const evidenceHash = (e: Evidence): Hex => hashCanonical(e)
