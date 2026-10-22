// Dashboard configuration (Mezo testnet deployment). Kept separate so a redeploy only touches this file.
export const CONFIG = {
	mezoRpc: 'https://rpc.test.mezo.org',
	ethRpc: 'https://ethereum-rpc.publicnode.com',
	explorer: 'https://explorer.test.mezo.org',
	sentinelLens: '0x007dD5902f0B50099ce163e1E12a74275f5e02B5',
	decisionLog: '0x8ACFA64297Cd64590ff9D18067cdb475A65a3880',
	decisionLogDeployBlock: 16291101,
	vault: '0xC92BfDC83b03d32e39930Bfb789233e1Cc0fdbEF',
	lifelineFactory: '0x37aC7acd4e48b79bb0dc6AaCA5AF3611cF176149',
	relayer: '0xFeEde29e521cd2ebbb31AbA13c1b145090b6c4a7',
	chainlinkBtcUsd: '0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c',
	coingecko: 'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,mezo-usd&vs_currencies=usd',
	coinbase: 'https://api.coinbase.com/v2/prices/BTC-USD/spot',
	confirmations: 2,
	maxWalk: 400,
	frontN: 5,
	repo: 'https://github.com/XachP/lifeline-sentinel',
}
