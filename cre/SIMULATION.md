# `cre workflow simulate`: Lifeline Sentinel

The workflow ran in the Chainlink CRE simulator (CRE CLI v1.39.0, `@chainlink/cre-sdk` 1.23.0) against live data. The CRE account was logged in with `cre login`. **Deploy access** (early access) has not been requested and isn't needed, because the bounty accepts a CLI simulation. Nothing was broadcast: no `--broadcast` flag and no write target configured.

```bash
cd cre
cre workflow simulate sentinel --target staging-settings --non-interactive --trigger-index 0
```

* Run: **Oct 22, 2026, 4:07 AM CDT** (09:07 UTC). The simulator labels its local clock with a `Z` suffix, so its log lines read `04:07Z`.
* Mezo testnet pinned block **16295727** (median head 16295729, minus 2 confirmations).
* Result: **HOLD**, confidence 62.2%, practice trade **REDEMPTION_ARB** (buy 2000 MUSD and redeem at $1, edge 31 bps), trove ICR 145.58%.
* Raw, unedited transcript: [`simulation-output.txt`](simulation-output.txt). It contains no secrets. The "default private key" line is the CLI's built-in, publicly known simulation key, used only for simulated chain writes.

## What the transcript shows

| Step | CRE capability | Transcript line |
|---|---|---|
| Trigger | Cron (`0 */10 * * * *`) | `Running trigger trigger=cron-trigger@1.0.0` |
| Mezo state at a pinned block | HTTPClient, JSON-RPC `eth_blockNumber` (median), then `eth_call` to SentinelLens at the pinned block | `mezo head 16295729 (median), pinned 16295727` |
| Chainlink BTC/USD | EVMClient.callContract on Ethereum mainnet (`latestRoundData`) | `Q2_oracle_agreement: mezo vs chainlink 26 bps`, `Q4_chainlink_fresh: age 2329s` |
| CEX prices | HTTPClient (CoinGecko and Coinbase, median consensus) | `Q3_cex_agreement: coingecko vs coinbase 0 bps` |
| Bull / bear debate | Deterministic agents (`core/agents.ts`) | `bull 470 [B2…B7]`, `bear 348 [R1,R3,R8]` |
| Judge | Policy-hashed rules (`core/judge.ts`) | 6 data-quality gates PASS; R1/R2 do not fire; `R3_default_hold`; `P1_redemption_arb` |
| Decision + hashes | `runtime.report` (signed report) | `decision HOLD conf=6220 practice=REDEMPTION_ARB evidence=0x607d… policy=0x5706…` |
| Write | EVMClient.writeReport (only if `write` is configured) | `no write target configured: signed report produced, not submitted` |

Final workflow result:

```json
{"action":"HOLD","practice":"REDEMPTION_ARB","icrBps":14558,"bull":470,"bear":348,
 "evidenceHash":"0x607d5c7872aed3186f2d67d21b534f58fbdffcc6a9f0bfc562895821ed754066",
 "policyHash":"0x57065b3444adb76b5fbdc26e209f2d89ec531bdce8a189657e6ddfc527304b89",
 "reasoningHash":"0x418f0b256037bdcdbd492159bd85828d5c769cd7a70af3c488b004d1704adcb8","tx":null}
```

## Cross-check against the local CLI

`bun cli.ts --at-block 16295727` rebuilds the evidence at the same Mezo block outside CRE ([`docs/backtest/16295727.json`](../docs/backtest/16295727.json)). It reaches the same verdict:

* **HOLD**, conf 62.2%, REDEMPTION_ARB 2000 MUSD
* bull 470 / bear 348, ICR 14558 bps
* the same rule trail and the same `policyHash` `0x5706…4b89`

The evidence hash differs (`0x0436…9560`) because the backtest uses CoinGecko's historical point and an exact block timestamp, while the simulator saw live prices about 3 minutes later (CEX spread 0 vs 1 bps, Chainlink age 2329 vs 2137 s). For identical bytes, the SDK-mock test in `test/workflow.test.ts` feeds recorded inputs through the CRE path and matches the CLI bit-for-bit (`bun test`: 32 pass).

## Reproduce

```bash
cd cre/sentinel && bun install && cd ..
cre login                                   # free CRE account
cre workflow simulate sentinel --target staging-settings --non-interactive --trigger-index 0
```
