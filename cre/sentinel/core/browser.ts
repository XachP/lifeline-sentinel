// Browser bundle for the dashboard (docs/sentinel-core.js): the same core the CRE workflow runs, plus the
// few viem helpers the page needs. Build: bun run build:web
export * from './index'
export { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256, stringToBytes, toEventSelector } from 'viem'
