// Derived quantities, all integer math. Shared by both agents and the judge so they argue from the same numbers.
import type { Evidence } from './evidence'
import type { Policy } from './policy'

const B = (s: string | number) => BigInt(s)
const absDiffBps = (a: bigint, b: bigint) => (b === 0n ? 0n : ((a > b ? a - b : b - a) * 10000n) / b)

export type Metrics = {
	icrBps: number
	triggerBps: number
	headroomBps: number // icr - trigger, in ICR basis points (can be negative)
	liquidationGapBps: number // how far BTC can fall before liquidation
	debtAheadMusd: number // whole MUSD
	redemptionBufferMusd: number
	rankFromFront: number
	queueSize: number
	reserveFunded: boolean
	tcrBps: number
	mezoPriceCents: number
	chainlinkCents: number
	oracleDeviationBps: number // Mezo oracle vs Chainlink
	cexDeviationBps: number // CoinGecko vs Coinbase
	chainlinkAgeSec: number
	snapshotLagSec: number
	musdMicros: number
	arbEdgeBps: number // 10000 - price(bps of $1) - fee
}

export function metrics(e: Evidence, p: Policy): Metrics {
	const m = e.mezo
	const icr = B(m.icrE18)
	const trig = B(m.triggerE18)
	const price = B(m.priceE18)
	const liq = B(m.liquidationPriceE18)
	const mezoCents = price / 10n ** 16n
	const clCents = B(e.chainlink.answerE8) / 10n ** 6n
	const cg = B(e.market.btcUsdCentsCoingecko)
	const cb = B(e.market.btcUsdCentsCoinbase)
	const musd = Number(e.market.musdUsdMicros)
	return {
		icrBps: Number(icr / 10n ** 14n),
		triggerBps: Number(trig / 10n ** 14n),
		headroomBps: Number((icr - trig) / 10n ** 14n),
		liquidationGapBps: price === 0n || liq === 0n ? 10000 : Number(((price - liq) * 10000n) / price),
		debtAheadMusd: Number(B(m.debtAheadWei) / 10n ** 18n),
		redemptionBufferMusd: Number(B(p.risk.redemptionBufferMusd) / 10n ** 18n),
		rankFromFront: Number(m.rankFromFront),
		queueSize: Number(m.queueSize),
		reserveFunded: B(m.reserveBtcWei) > 0n || B(m.reserveMusdWei) > 0n,
		tcrBps: Number(B(m.tcrE18) / 10n ** 14n),
		mezoPriceCents: Number(mezoCents),
		chainlinkCents: Number(clCents),
		oracleDeviationBps: Number(absDiffBps(mezoCents, clCents)),
		cexDeviationBps: Number(absDiffBps(cg, cb)),
		chainlinkAgeSec: e.observedAt - Number(e.chainlink.updatedAt),
		snapshotLagSec: e.observedAt - Number(m.blockTime),
		musdMicros: musd,
		arbEdgeBps: 10000 - Math.ceil(musd / 100) - p.practice.assumedRedemptionFeeBps,
	}
}

export const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`
export const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
export const musdFmt = (n: number) => `${n.toLocaleString('en-US')} MUSD`
