#!/usr/bin/env bash
# Deploy SentinelLens + DecisionLog to Mezo testnet and register policy v1.
# Uses the TESTNET-ONLY deployer key from a local wallet file (never printed, never committed).
# The deployer is also the disclosed relayer (DecisionLog.forwarder) until CRE supports Mezo; see README "Trust model".
set -euo pipefail
export PATH="$HOME/.foundry/bin:$PATH"
ROOT=$(cd "$(dirname "$0")/.." && pwd)
R=${MEZO_RPC:-https://rpc.test.mezo.org}
WALLET=${DEPLOYER_WALLET:-/workspace/crypto-earn/wallet/mezo_testnet_deployer.json}
KEY=$(python3 -c "import json,sys;d=json.load(open(sys.argv[1]))['data'];w=d[0] if isinstance(d,list) else d;print(w['private_key'])" "$WALLET")
ME=$(cast wallet address --private-key "$KEY")
echo "deployer/relayer $ME balance $(cast from-wei $(cast balance $ME -r $R)) BTC"
POLICY_HASH=$(cd "$ROOT/cre/sentinel" && bun -e "import {policyHash} from './core'; console.log(policyHash())")
echo "policy v1 hash $POLICY_HASH"
cd "$ROOT/contracts"
OUT=$(FORWARDER=$ME POLICY_HASH=$POLICY_HASH POLICY_URI=${POLICY_URI:-https://xachp.github.io/lifeline-sentinel/policy/v1.json} \
  forge script script/Deploy.s.sol --rpc-url $R --broadcast --private-key "$KEY" --legacy --slow 2>&1) || { echo "$OUT" | tail -30; exit 1; }
LENS=$(echo "$OUT" | awk '/SentinelLens:/{print $2}' | tail -1)
DLOG=$(echo "$OUT" | awk '/DecisionLog:/{print $2}' | tail -1)
echo "SentinelLens: $LENS"; echo "DecisionLog: $DLOG"
cat > "$ROOT/deployments/mezo-testnet.json" <<JSON
{
  "chainId": 31611,
  "sentinelLens": "$LENS",
  "decisionLog": "$DLOG",
  "relayer": "$ME",
  "policyV1Hash": "$POLICY_HASH",
  "broadcast": "contracts/broadcast/Deploy.s.sol/31611/run-latest.json"
}
JSON
echo "wrote deployments/mezo-testnet.json"
