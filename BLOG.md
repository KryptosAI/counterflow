# Counterflow — Prove the Contract, or Reveal the Exploit (now in your CI)

Formal verification has been the gold standard for smart contract security since the DAO hack, but it's been locked behind proprietary tools, DSL expertise, and six-figure auditor retainers. Counterflow changes that — and as of v0.5.1, it runs in your GitHub Actions in three lines of YAML.

## What Counterflow does

You write invariants in plain English. The LLM translates them into a structured binding — a machine-readable specification of your contract's guards, effects, and invariants. That binding flows into a human-auditable Z3 solver core that either proves the invariant holds for *all possible inputs* or produces a concrete counterexample — an exploit trace showing exactly how a violation occurs.

**The LLM never decides the verdict.** It only translates. If the LLM makes a mistake, the translation is either rejected by the schema validator or disproved by the Z3 solver. False positives are structurally impossible. The trusted core is deterministic SMT; the untrusted layer is AI translation with a human-in-the-loop.

Then Halmos runs symbolic execution against EVM bytecode as a backstop, closing any gap between the binding abstraction and what actually executes on-chain.

## New: the GitHub Action

```yaml
- uses: KryptosAI/counterflow-action@v1
  with:
    binding: path/to/Contract.binding.json
```

Green on **PROVED**, red with a counterexample on **VIOLATED**. The verdict lands in your job summary; pass `github-token` and it keeps a single updated comment on your PR. The action is dogfooded in Counterflow's own CI.

There's also a **live leaderboard** at [kryptosai.github.io/counterflow](https://kryptosai.github.io/counterflow/) — every benchmark, exploit reproduction, and real-contract model, re-verified by CI on every push. It only ever publishes green, and it already caught a real documentation bug: three "PROVED" real-contract bindings had quietly drifted out from under the claim as the vocabulary evolved. The leaderboard gate exposed it; the bindings are corrected and the claim is now CI-enforced.

## By the numbers

Counterflow ships with **5 state models** covering the most common DeFi primitives:

| Model | Domain |
|---|---|
| `erc20_pool` | Token pools, vaults, ERC-4626 |
| `amm_pool` | Constant-product AMMs, Uniswap V2 pairs |
| `lending_pool` | Overcollateralized lending, Aave, Compound |
| `staking_pool` | Staking and reward distribution |
| `cross_contract` | Multi-contract interactions |

The vocabulary spans **27 guards, 43 effects, and 33 invariants** — enough to model real-world DeFi logic without drowning in complexity.

The benchmark suite is deterministic and LLM-free: **16/16 exploit patterns** correct (reference contracts proved safe, known-buggy variants produce counterexamples). **5/5 DeFiHackLabs cases reproduced** — real, historical exploits totaling over $261 million: FEI Protocol ($80M), CREAM Finance ($130M), PancakeBunny ($45M), OpenLeverage ($230K), Belt Finance ($6.3M). **3/3 real contract models** (Uniswap V2 Swap, Aave Lending, Compound cToken) proved at the Z3 level. **9/9 Halmos bytecode scenarios** gated in CI — the 6 known exploits must stay reproducible or the build goes red. **35/35 e2e tests.**

## Also new: opt-in k-induction

Add `"init": ["all_zero"]` and `"induction": {"k": 2}` to any binding and the solver additionally checks **initiation** — bounded model checking from a zero deploy state, so a violation is a *reachable* exploit, reported with its depth — then proves the step over k linked transitions of the full multi-function transition relation. Default behavior (k=1) is unchanged.

## Get started

```bash
npm install @kryptosai/counterflow   # needs Python 3 + z3-solver
counterflow doctor
counterflow check examples/TokenPool.binding.json      # PROVED
counterflow check examples/TokenPoolBuggy.binding.json  # VIOLATED + exploit trace
```

Counterflow is MIT licensed. The trusted Z3 core is open and auditable. The commercial layer adds hosted pipelines, dashboards, and proof storage — but the CLI, the solver, the benchmark corpus, and the GitHub Action all ship free.

Prove the contract. Or reveal the exploit.
