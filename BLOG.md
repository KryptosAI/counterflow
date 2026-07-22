# Counterflow v0.4.0 — Prove the Contract, or Reveal the Exploit

Formal verification has been the gold standard for smart contract security since the DAO hack, but it's been locked behind proprietary tools, DSL expertise, and six-figure auditor retainers. Counterflow changes that.

## What Counterflow does

You write invariants in plain English. The LLM translates them into a structured binding — a machine-readable specification of your contract's guards, effects, and invariants. That binding flows into a ~560-line, human-auditable Z3 solver core that either proves the invariant holds for *all possible inputs* or produces a concrete counterexample — an exploit trace showing exactly how a violation occurs.

**The LLM never decides the verdict.** It only translates. If the LLM makes a mistake, the translation is either rejected by the schema validator or disproved by the Z3 solver. False positives are structurally impossible. The trusted core is deterministic SMT; the untrusted layer is AI translation with a human-in-the-loop.

Then Halmos runs symbolic execution against EVM bytecode as a backstop, closing any gap between the binding abstraction and what actually executes on-chain.

## By the numbers

Counterflow v0.4.0 ships with **5 state models** covering the most common DeFi primitives:

| Model | Domain |
|---|---|
| `erc20_pool` | Token pools, vaults, ERC-4626 |
| `amm_pool` | Constant-product AMMs, Uniswap V2 pairs |
| `lending_pool` | Overcollateralized lending, Aave, Compound |
| `staking_pool` | Staking and reward distribution |
| `cross_contract` | Multi-contract interactions |

The vocabulary spans **23 guards, 40 effects, and 29 invariants** — enough to model real-world DeFi logic without drowning in complexity.

The benchmark suite is deterministic and LLM-free: **12/12 synthetic exploit patterns** proven correct (reference contracts proved safe, known-buggy variants produce counterexamples). **5/5 DeFiHackLabs cases reproduced** — real, historical exploits totaling over $261 million in losses, including FEI Protocol ($80M), CREAM Finance ($130M), PancakeBunny ($45M), OpenLeverage ($230K), and Belt Finance ($6.3M). **3/3 real contract models** (Uniswap V2 Swap, Aave Lending, Compound cToken) proved safe at the Z3 level. **9/9 Halmos bytecode tests** provide EVM-level confirmation.

## What's new in v0.4.0

Six new CLI commands: `doctor` checks all your dependencies, `leaderboard` displays verified contracts, `badge` generates verification badges, `serve` launches the audit dashboard, `completeness` reports vocabulary coverage, and `mutate` runs mutation testing against the vocabulary.

New documentation covers trophies (every vulnerability caught), the leaderboard (ranked verified contracts), and a security policy explaining the trust model — what PROVED actually means, and what it doesn't.

## Get started

```bash
npm install @kryptosai/counterflow
counterflow doctor
counterflow check examples/TokenPool.binding.json      # PROVED
counterflow check examples/TokenPoolBuggy.binding.json  # VIOLATED + exploit trace
```

Counterflow is MIT licensed. The trusted Z3 core is open and auditable. The commercial layer adds hosted pipelines, CI integration, and proof storage — but everything you need to run deterministic verification locally ships with the package.

Prove the contract. Or reveal the exploit.
