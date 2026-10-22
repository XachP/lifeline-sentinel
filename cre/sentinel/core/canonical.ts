// Canonical JSON + hashing. Everything that gets hashed is built only from strings, integers and booleans
// (bigints are written as decimal strings), keys sorted at every level, no whitespace. Same bytes on every
// CRE node, in the CLI, and in the browser replay.
import { keccak256, stringToBytes, type Hex } from 'viem'

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

export function canonicalize(value: unknown): string {
	if (value === null || value === undefined) return 'null'
	if (typeof value === 'bigint') return JSON.stringify(value.toString())
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value)) throw new Error(`non-integer number in canonical JSON: ${value}`)
		return String(value)
	}
	if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
	if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
	if (typeof value === 'object') {
		const o = value as Record<string, unknown>
		const keys = Object.keys(o)
			.filter((k) => o[k] !== undefined)
			.sort()
		return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(o[k])}`).join(',')}}`
	}
	throw new Error(`unsupported type in canonical JSON: ${typeof value}`)
}

export const hashCanonical = (value: unknown): Hex => keccak256(stringToBytes(canonicalize(value)))
