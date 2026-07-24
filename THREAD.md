# Tweet Thread Draft — Counterflow GitHub Action launch

---

**Tweet 1/6**

Prove the contract, or reveal the exploit — now in your CI.

Counterflow is MIT-licensed formal verification for Solidity. Three lines of YAML and every PR gets Z3-proved invariants or a concrete exploit trace.

github.com/KryptosAI/counterflow-action

---

**Tweet 2/6**

```yaml
- uses: KryptosAI/counterflow-action@v1
  with:
    binding: path/to/Contract.binding.json
```

Green on PROVED. Red with a counterexample on VIOLATED.

Optional: pass github-token and it keeps one updated verdict comment on your PR.

---

**Tweet 3/6**

The trick: the LLM never decides the verdict.

It translates your English invariants → a binding JSON you review. A deterministic Z3 core then PROVES the invariant for all inputs or produces the exploit trace.

Hallucination can't create a false positive — the validator rejects it or Z3 disproves it.

---

**Tweet 4/6**

Receipts (deterministic, no LLM, all gated in CI):

• 16/16 exploit patterns correct
• 5/5 DeFiHackLabs reproduced ($261M+): FEI $80M · CREAM $130M · PancakeBunny $45M · OpenLeverage $230K · Belt $6.3M
• 3/3 real contracts: Uniswap V2, Aave, Compound
• 9/9 Halmos bytecode scenarios

Live: kryptosai.github.io/counterflow

---

**Tweet 5/6**

The leaderboard re-verifies everything on every push and only publishes green.

Its first run caught us: 3 "PROVED" real-contract bindings had drifted to VIOLATED as the vocabulary evolved. Claim was stale, gate caught it, bindings fixed, claim now CI-enforced.

Build expectation gates. They work.

---

**Tweet 6/6**

Also in v0.5.x:

• opt-in k-induction: "init": ["all_zero"] + "induction": {"k": 2} → initiation checking from deploy state + k-step proofs
• SHA-256 hash-chained audit log
• Foundry/Echidna/CVL export

npm install @kryptosai/counterflow
github.com/KryptosAI/counterflow
