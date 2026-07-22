# Counterflow Leaderboard

Verified contracts ranked by verification date. Run `counterflow leaderboard` to see the live table from your audit log.

| # | Contract | Model | Verdict | Invariants | Functions | Duration | Date |
|---|---|---|---|---|---|---|---|
| 1 | PaymentChannel | erc20_pool | proved | 1 | 4 | ~115ms | 2026-07-17 |
| 2 | CrossChainSettlement | erc20_pool | proved | 1 | 3 | ~110ms | 2026-07-17 |
| 3 | SubscriptionManager | erc20_pool | proved | 1 | 3 | ~105ms | 2026-07-17 |
| 4 | TokenPool | erc20_pool | proved | 3 | 2 | ~140ms | 2026-07-17 |
| 5 | SafeVault | erc20_pool | proved | 7 | 3 | ~160ms | 2026-07-17 |
| 6 | AMMSwap | amm_pool | proved | 3 | 3 | ~155ms | 2026-07-17 |
| 7 | LendingPool | lending_pool | proved | 7 | 4 | ~315ms | 2026-07-17 |
| 8 | StakingPool | staking_pool | proved | 4 | 3 | ~180ms | 2026-07-17 |
| 9 | UniswapV2Swap | amm_pool | proved | 5 | 3 | ~160ms | 2026-07-17 |
| 10 | AaveLending | lending_pool | proved | 7 | 4 | ~310ms | 2026-07-17 |
| 11 | CompoundCToken | lending_pool | proved | 7 | 2 | ~200ms | 2026-07-17 |

## Legend

- **proved** — all invariants hold for all possible inputs
- **violated** — Z3 found a concrete counterexample
- **unknown** — solver could not decide

## Contributing a verified contract

1. Write your Solidity contract and English invariants
2. Run `counterflow extract Contract.sol invariants.txt -o binding.json`
3. Review the binding
4. Run `counterflow check binding.json`
5. Submit a PR adding your contract to this leaderboard

See [TROPHIES.md](TROPHIES.md) for the full list of vulnerabilities caught.
