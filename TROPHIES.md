# Counterflow Trophies

Vulnerabilities caught by Counterflow formal verification. Each entry includes the exploit class, invariant violated, and a concrete counterexample found by the Z3 solver.

## Synthetic Benchmark (16 cases)

| Contract | Class | Invariant Violated | Loss (real) |
|---|---|---|---|
| TokenPoolBuggy | underflow-drain | nonneg_balance | — |
| ApprovalDrain | approval-drain | nonneg_allowance | — |
| UnbackedMintVault | unbacked-mint | backing | — |
| BurnDesyncVault | accounting-desync | shares_integrity | — |
| AMMPriceManipulation | price-manipulation | nonneg_reserves | — |
| LendingUnbackedBorrow | unbacked-borrow | overcollateralized | — |
| StakingInfiniteReward | infinite-reward | nonneg_balance | — |
| OracleManipulation | oracle-manipulation | oracle_integrity | — |
| GovernanceNoTimelock | missing-timelock | solvency | — |

## DeFiHackLabs Reproductions (5 cases, $261M+ total)

| Exploit | Class | Contract | Loss | Invariant Violated |
|---|---|---|---|---|
| FEI Protocol | reentrancy | FeiProtocol.sol | $80M | reentrancy_safe |
| CREAM Finance | ERC777 reentrancy | CreamFinance.sol | $130M | nonneg_balance |
| PancakeBunny | flash-loan | PancakeBunny.sol | $45M | backing |
| OpenLeverage | access-control | OpenLeverage.sol | $230K | backing |
| Belt Finance | arithmetic underflow | BeltFinance.sol | $6.3M | solvency |

## Real Contract Models (3 cases)

| Contract | Model | Class | Verdict |
|---|---|---|---|
| UniswapV2Swap | amm_pool | safe reference | PROVED |
| AaveLending | lending_pool | safe reference | PROVED |
| CompoundCToken | lending_pool | safe reference | PROVED |

## ValuePacket (3 cases)

| Contract | Verdict |
|---|---|
| PaymentChannel | PROVED (pool-level) |
| CrossChainSettlement | PROVED (pool-level) |
| SubscriptionManager | PROVED (pool-level) |

## How to add a trophy

1. Write the Solidity contract
2. Write invariants in English
3. Run `counterflow extract Contract.sol invariants.txt` (or write binding by hand)
4. Run `counterflow check binding.json`
5. If VERIFIED, add to this file

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full guide.
