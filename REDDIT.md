# Counterflow v0.4.0 — LLM-translated, Z3-proved invariant checking (MIT)

I'm sharing Counterflow v0.4.0, an open-core formal verification tool for Solidity smart contracts. It takes English invariants, translates them via LLM to a structured binding, then runs deterministic Z3 SMT and Halmos symbolic execution to prove safety or produce counterexamples.

## How it compares to existing tools

Counterflow occupies a different spot in the verification landscape than Certora, Halmos, or Kontrol. Here's how they stack up:

### Certora Prover
- **License:** GPL-3.0 (Counterflow: MIT)
- **Input:** CVL — a custom specification language you must learn
- **Proof level:** SMT-based, similar to Counterflow's Z3 core
- **Setup:** Java + Gradle
- **Where Counterflow wins:** No DSL — you write invariants in English. The LLM handles translation, you review the binding. Certora also locks verification in their cloud; Counterflow runs fully local with a SHA-256 hash-chained audit log.
- **Where Certora wins:** Mature tooling, scene linking for multi-contract, battle-tested on major protocols. Unlimited model expressiveness vs. Counterflow's 5 vocabulary-bound models (extensible but bounded by design).

### Halmos (a16z)
- **License:** AGPL-3.0 (Counterflow: MIT)
- **Input:** Foundry test functions with symbolic variables — you write the test, Halmos symbolically executes it
- **Proof level:** EVM bytecode symbolic execution
- **Where Counterflow wins:** Halmos is a bytecode backstop *within* Counterflow. You get the Z3 abstract proof first (fast, ~100-320ms per case), then Halmos confirms at the bytecode level. Halmos alone requires you to write algebraic test harnesses; Counterflow generates them from the binding.
- **Where Halmos wins:** Direct EVM-level reasoning — no abstraction gap. Excellent for verifying compiler output matches source intent.

### Kontrol (Runtime Verification)
- **License:** BSD-3
- **Input:** Foundry test functions, like Halmos
- **Proof level:** KEVM bytecode symbolic execution (K framework)
- **Setup:** K framework + Nix (complex)
- **Where Counterflow wins:** Zero setup complexity (npm + Python). English invariants instead of hand-written algebraic test functions. The LLM translation layer means non-formal-methods engineers can write specifications.
- **Where Kontrol wins:** Unlimited expressiveness via K framework. Full EVM semantics at the bytecode level. Strong for complex multi-contract interactions.

### Counterflow's unique position

1. **English input, machine proof.** The LLM translates English invariants to a formal binding, but the verdict comes from deterministic Z3 and Halmos. The LLM cannot produce a false positive.

2. **Defense in depth.** Z3 abstract proof → validator schema gate → Halmos bytecode backstop → SHA-256 audit chain. Each layer catches different classes of error.

3. **Deterministic reproduction.** Every benchmark result, including 5/5 DeFiHackLabs reproductions ($261M+), runs without an LLM. The bindings are pre-reviewed JSON files. Anyone can reproduce the results with `npm run bench`.

4. **Vocabulary-bound, extensible.** The 5 model types (erc20_pool, amm_pool, lending_pool, staking_pool, cross_contract) with 23 guards, 40 effects, and 29 invariants constrain the translation problem so the LLM rarely hallucinates. The vocabulary is extensible — you can add custom guards and effects to the trusted core.

5. **MIT license.** Everything ships under MIT — the CLI, the Z3 core, the validator, the benchmarks, the DeFiHackLabs corpus. The commercial layer (hosted pipeline, CI, dashboards) is separate.

## What v0.4.0 ships

```
npm install @kryptosai/counterflow

counterflow check examples/TokenPool.binding.json       # PROVED
counterflow check examples/TokenPoolBuggy.binding.json  # VIOLATED + cex
counterflow verify Contract.sol invariants.txt          # full AI pipeline
counterflow bytecode HalmosTest                         # 9 EVM symbolic tests
counterflow doctor                                       # check deps
counterflow leaderboard                                  # view verified contracts
```

- 12/12 benchmark, 5/5 DeFiHackLabs ($261M+), 3/3 real contracts, 9/9 Halmos bytecode
- New CLI: doctor, leaderboard, badge, serve, completeness, mutate
- New docs: TROPHIES.md, LEADERBOARD.md, SECURITY.md

## Limitations (honest)

- Proofs are over the binding abstraction, not the Solidity source directly
- The Z3 model uses unbounded integers — does not model EVM mod-2^256 wrap
- Gas is not modeled
- Vocabulary is bounded — complex governance or oracle logic needs custom extensions
- The LLM translation layer requires human review (by design)
- Multi-contract proofs limited to the cross_contract vocabulary

Happy to answer questions. Repo: https://github.com/KryptosAI/counterflow
