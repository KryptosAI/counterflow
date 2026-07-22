# <picture><img src="assets/logo.png" height="48" align="left" alt="Counterflow logo"/></picture>Counterflow

[![npm version](https://img.shields.io/npm/v/@kryptosai/counterflow)](https://www.npmjs.com/package/@kryptosai/counterflow)
[![CI](https://github.com/KryptosAI/counterflow/actions/workflows/ci.yml/badge.svg)](https://github.com/KryptosAI/counterflow/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@kryptosai/counterflow)](https://github.com/KryptosAI/counterflow/blob/main/LICENSE)
[![node >=18](https://img.shields.io/node/v/@kryptosai/counterflow)](https://nodejs.org/)

> **Prove the contract, or reveal the exploit.**

Counterflow is a smart contract security CLI: AI-translated, machine-proved formal verification for Solidity DeFi contracts — English invariants are checked by a trusted Z3/SMT core, backed by symbolic execution (Halmos, Foundry) and Echidna harness generation for invariant testing. 5 model types, 16 benchmark cases across erc20, amm, lending, staking, oracle, and governance, and 5 real DeFi exploits reproduced ($261M+).

**The LLM never decides the verdict.** A ~560-line human-auditable Z3 core either *proves* the invariant for **all** inputs or produces a **concrete counterexample** (an exploit trace).

```
Solidity + English invariants
        │
        ▼
  [LLM translate]          untrusted — DeepSeek/OpenAI, temperature 0
        │
        ▼
  binding.json             human-reviewable artifact (the real spec)
        │
        ▼
  [validate]               deterministic vocabulary/schema gate (5 models, 27 guards, 43 effects, 33 invariants)
        │
        ▼
  [Z3 inductive check]     TRUSTED — 5 model types: erc20_pool, amm_pool, lending_pool, staking_pool, cross_contract
        │
        ▼
  PROVED | VIOLATED (+ cex)   →   audit.jsonl (SHA-256 hash-chained)
        │
        ▼
  [Halmos bytecode]        TRUSTED — EVM symbolic exec (9 scenarios, 3 PASS / 6 FAIL confirming exploits)
  [Foundry fuzz+symb]      fuzz → cex → halmos symbolic proof
  [Echidna validation]     harness generation from binding
```

## State model (5 types)

| Model | Vocab | Guards | Effects | Invariants |
|---|---|---|---|---|
| `erc20_pool` | balances, shares, allowances, totals, ghost sums | 11 | 16 | 10 |
| `amm_pool` | reserveX/Y, lpSupply, lpBalances, initialK | 5 | 8 | 5 |
| `lending_pool` | collateral, debt, totals, liqThreshold | 3 | 8 | 8 |
| `staking_pool` | staked, rewards, totalStaked, rewardPool | 2 | 6 | 5 |
| `cross_contract` | cross-in-progress flag, snapshots | 2 | 2 | 1 |
| shared extensions | oracle (price, twap), governance (timelock) | 4 | 3 | 4 |

All models share reentrancy vocabulary (lock/snapshot/external-call). The oracle and governance extensions are shared vocabulary usable across models.

## Installation

```bash
npm install @kryptosai/counterflow
# deps: Python 3 + z3-solver (pip install z3-solver)
# optional: halmos (pip install halmos), Foundry (brew install foundry)
counterflow doctor   # check all deps
```

## Quickstart

```bash
counterflow check examples/TokenPool.binding.json      # PROVED
counterflow check examples/TokenPoolBuggy.binding.json # VIOLATED + exploit
counterflow verify Contract.sol invariants.txt         # full AI pipeline (needs API key)
counterflow check binding.json                         # deterministic, no LLM
counterflow bytecode HalmosTest                        # 9 EVM symbolic tests
counterflow bytecode --expect                          # gate: 3 PASS / 6 exploits must reproduce
counterflow audit                                      # verify SHA-256 chain
```

## Benchmark

```
16/16 solver cases correct (110-320ms per case):
  erc20_pool: TokenPool†, SafeVault†, TokenPoolBuggy✗, ApprovalDrain✗, UnbackedMintVault✗, BurnDesyncVault✗
  amm_pool:   AMMSwap†, AMMPriceManipulation✗
  lending:    LendingPool†, LendingUnbackedBorrow✗
  staking:    StakingPool†, StakingInfiniteReward✗
  oracle:     OracleSafe†, OracleManipulation✗
  governance: GovernanceTimelock†, GovernanceNoTimelock✗

5/5 DeFiHackLabs real exploits reproduced (deterministic, no LLM):
  FEI Protocol      ($80M)  reentrancy        → reentrancy_safe violated
  CREAM Finance     ($130M) ERC777 reentrancy  → nonneg_balance violated
  PancakeBunny      ($45M)  flash loan         → backing violated
  OpenLeverage      ($230K) access control     → backing violated
  Belt Finance      ($6.3M) arithmetic         → solvency violated

3/3 ValuePacket contracts PROVED at pool level
9/9 Halmos scenarios match expectations (3 PASS / 6 exploits reproduced)
35/35 e2e tests pass
```

## How it works

1. You write invariants in English or Solidity comments
2. LLM translates contract + invariants → structured binding JSON (untrusted layer)
3. Deterministic Z3 core proves or produces a counterexample (trusted layer)
4. Optional Halmos bytecode backstop closes spec-vs-implementation gap
5. SHA-256 hash-chained audit log records every run
6. Optional k-induction: add `"init": ["all_zero"]` and `"induction": {"k": 2}` to a
   binding to also check initiation (BMC from a zero state — a base-case violation
   is a *reachable* exploit) and prove the inductive step over k linked transitions
   (`counterflow check` handles it automatically; default k=1 is unchanged)

## Counterflow vs the landscape

| | Counterflow | Certora Prover | Kontrol | Halmos |
|---|---|---|---|---|
| Licence | MIT | GPL-3.0 | BSD-3 | AGPL-3.0 |
| Input | English | CVL spec | Foundry tests | Foundry tests |
| Proof level | Z3 abstract | SMT | KEVM bytecode | Symbolic |
| Multi-contract | Yes (cross_contract model + Halmos) | Yes (scene linking) | Yes | Yes |
| Model types | 5 (extensible) | Unlimited | Unlimited | N/A |
| Bytecode backstop | Halmos + Foundry | No | Native | Native |
| Audit chain | SHA-256 | Cloud | No | No |
| Setup | npm + Python | Java + Gradle | K + Nix | pip |

## What a verdict means

- **PROVED** — the modeled transition preserves the invariant for *all* possible inputs
- **VIOLATED** — Z3 or Halmos found a concrete counterexample (exploit trace)
- **UNKNOWN** — solver could not decide within limits
- **VACUOUS** — (per-function flag) the function's guards are unsatisfiable, so its proofs are vacuous; review the binding

## Open core (MIT)

CLI, translation prompts, validation, trusted Z3 core, Halmos tests, benchmark bindings, DeFiHackLabs corpus, defi hack runner, ValuePacket verification suite. Commercial layer (separate): hosted pipeline, CI integration, dashboards, proof storage.

## Roadmap

- Kontrol integration as second bytecode backstop
- CVL export for Certora Prover interop
- Richer Z3 models: compound interest
- VS Code extension with inline binding review
- Public leaderboard on GitHub Pages
