// The 13-word report DecisionLog.onReport() decodes. Keep in sync with contracts/src/DecisionLog.sol.
import { decodeAbiParameters, encodeAbiParameters, type Hex } from 'viem'
import type { Decision } from './judge'

export const REPORT_PARAMS = [
	{ name: 'observedAt', type: 'uint64' },
	{ name: 'mezoBlock', type: 'uint64' },
	{ name: 'vault', type: 'address' },
	{ name: 'action', type: 'uint8' },
	{ name: 'practice', type: 'uint8' },
	{ name: 'confidenceBps', type: 'uint16' },
	{ name: 'icrBps', type: 'uint32' },
	{ name: 'bullScore', type: 'int32' },
	{ name: 'bearScore', type: 'int32' },
	{ name: 'practiceSize', type: 'uint128' },
	{ name: 'evidenceHash', type: 'bytes32' },
	{ name: 'policyHash', type: 'bytes32' },
	{ name: 'reasoningHash', type: 'bytes32' },
] as const

export function encodeReport(d: Decision): Hex {
	return encodeAbiParameters(REPORT_PARAMS, [
		BigInt(d.observedAt),
		BigInt(d.mezoBlock),
		d.vault as Hex,
		d.action,
		d.practice,
		d.confidenceBps,
		d.icrBps,
		d.bull.score,
		d.bear.score,
		BigInt(d.practiceSize),
		d.evidenceHash,
		d.policyHash,
		d.reasoningHash,
	])
}

export const decodeReport = (data: Hex) => decodeAbiParameters(REPORT_PARAMS, data)
