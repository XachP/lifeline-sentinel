// ABIs + addresses shared by the CRE workflow, the CLI and the dashboard.
export const LENS_ABI = [
	{
		type: 'function',
		name: 'snapshot',
		stateMutability: 'view',
		inputs: [
			{ name: 'vault', type: 'address' },
			{ name: 'maxWalk', type: 'uint256' },
			{ name: 'frontN', type: 'uint256' },
		],
		outputs: [
			{
				name: 's',
				type: 'tuple',
				components: [
					{ name: 'blockNumber', type: 'uint256' },
					{ name: 'timestamp', type: 'uint256' },
					{ name: 'vault', type: 'address' },
					{ name: 'vaultOwner', type: 'address' },
					{
						name: 'health',
						type: 'tuple',
						components: [
							{ name: 'status', type: 'uint8' },
							{ name: 'price', type: 'uint256' },
							{ name: 'icr', type: 'uint256' },
							{ name: 'trigger', type: 'uint256' },
							{ name: 'target', type: 'uint256' },
							{ name: 'recoveryMode', type: 'bool' },
							{ name: 'needsProtection', type: 'bool' },
							{ name: 'coll', type: 'uint256' },
							{ name: 'debt', type: 'uint256' },
							{ name: 'reserveBtc', type: 'uint256' },
							{ name: 'reserveMusd', type: 'uint256' },
							{ name: 'liquidationPrice', type: 'uint256' },
							{ name: 'redemptionSafeICR', type: 'uint256' },
							{ name: 'redemptionRisk', type: 'bool' },
						],
					},
					{ name: 'tcr', type: 'uint256' },
					{ name: 'queueSize', type: 'uint256' },
					{ name: 'rankFromFront', type: 'uint256' },
					{ name: 'debtAhead', type: 'uint256' },
					{ name: 'walkComplete', type: 'bool' },
					{ name: 'lifelineVaults', type: 'uint256' },
					{
						name: 'front',
						type: 'tuple[]',
						components: [
							{ name: 'borrower', type: 'address' },
							{ name: 'icr', type: 'uint256' },
							{ name: 'debt', type: 'uint256' },
						],
					},
				],
			},
		],
	},
] as const

export const AGGREGATOR_V3_ABI = [
	{
		type: 'function',
		name: 'latestRoundData',
		stateMutability: 'view',
		inputs: [],
		outputs: [
			{ name: 'roundId', type: 'uint80' },
			{ name: 'answer', type: 'int256' },
			{ name: 'startedAt', type: 'uint256' },
			{ name: 'updatedAt', type: 'uint256' },
			{ name: 'answeredInRound', type: 'uint80' },
		],
	},
] as const

export const DECISION_LOG_ABI = [
	{ type: 'function', name: 'onReport', stateMutability: 'nonpayable', inputs: [{ name: 'metadata', type: 'bytes' }, { name: 'report', type: 'bytes' }], outputs: [] },
	{ type: 'function', name: 'registerPolicy', stateMutability: 'nonpayable', inputs: [{ name: 'policyHash', type: 'bytes32' }, { name: 'uri', type: 'string' }], outputs: [] },
	{ type: 'function', name: 'dispute', stateMutability: 'nonpayable', inputs: [{ name: 'id', type: 'uint256' }, { name: 'reasonHash', type: 'bytes32' }, { name: 'note', type: 'string' }], outputs: [] },
	{ type: 'function', name: 'disputeCount', stateMutability: 'view', inputs: [{ type: 'uint256' }], outputs: [{ type: 'uint256' }] },
	{ type: 'event', name: 'DecisionDisputed', inputs: [{ name: 'id', type: 'uint256', indexed: true }, { name: 'by', type: 'address', indexed: true }, { name: 'reasonHash', type: 'bytes32', indexed: false }, { name: 'note', type: 'string', indexed: false }] },
	{ type: 'function', name: 'decisionsCount', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
	{ type: 'function', name: 'policies', stateMutability: 'view', inputs: [{ type: 'bytes32' }], outputs: [{ name: 'active', type: 'bool' }, { name: 'registeredAt', type: 'uint64' }, { name: 'uri', type: 'string' }] },
	{
		type: 'event',
		name: 'DecisionLogged',
		inputs: [
			{ name: 'id', type: 'uint256', indexed: true },
			{ name: 'vault', type: 'address', indexed: true },
			{ name: 'action', type: 'uint8', indexed: false },
			{ name: 'practice', type: 'uint8', indexed: false },
			{ name: 'confidenceBps', type: 'uint16', indexed: false },
			{ name: 'icrBps', type: 'uint32', indexed: false },
			{ name: 'evidenceHash', type: 'bytes32', indexed: false },
			{ name: 'policyHash', type: 'bytes32', indexed: false },
			{ name: 'reasoningHash', type: 'bytes32', indexed: false },
		],
	},
] as const

export const MEZO_TESTNET = {
	chainId: 31611,
	rpc: 'https://rpc.test.mezo.org',
	explorer: 'https://explorer.test.mezo.org',
	lifelineFactory: '0x37aC7acd4e48b79bb0dc6AaCA5AF3611cF176149',
	lifelineVault: '0xC92BfDC83b03d32e39930Bfb789233e1Cc0fdbEF',
	troveManager: '0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0',
	sortedTroves: '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA',
	priceFeed: '0x86bCF0841622a5dAC14A313a15f96A95421b9366',
} as const

// Chainlink BTC/USD Data Feed, Ethereum mainnet (8 decimals)
export const CHAINLINK_BTC_USD_MAINNET = '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c'
