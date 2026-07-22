# Counterflow Security Policy

## Trust Model

Counterflow has three trusted layers and one untrusted layer:

| Layer | Trust | Why |
|---|---|---|
| Z3 core (solver/models.py) | TRUSTED | ~560 lines, human-auditable, deterministic SMT |
| Binding validation (validate.js) | TRUSTED | Schema gate, vocabulary enforcement |
| Halmos bytecode (optional) | TRUSTED | EVM symbolic execution (a16z project) |
| LLM translation (translate.js) | UNTRUSTED | AI-generated, must be human-reviewed |

The LLM never decides a verdict. A bad translation is caught by the validator or produces a model the solver disproves — never a false positive.

## What PROVED means (and doesn't mean)

**PROVED** = the modeled transition preserves the invariant for all possible inputs over the reviewed abstraction.

It is NOT a claim that the contract is "safe." The proof is only as good as the binding:
- If the binding omits a state variable, the proof is vacuously true
- If the binding mischaracterizes a guard, the proof is over the wrong model
- The bytecode backstop (Halmos) catches spec-vs-implementation gaps, but is bounded

## Reporting a Vulnerability

If you find a bug in Counterflow's trusted core (models.py, check.py, validate.js) that could produce a false proof:

1. Do NOT open a public issue
2. Email the maintainers directly
3. Include a minimal binding that produces the wrong verdict

For bugs in the LLM translation layer: open a GitHub issue with the contract + invariants that produced a wrong binding.

## Supported Versions

| Version | Status |
|---|---|
| v0.4.x | Supported |

## Known Limitations

- Proofs are over the binding abstraction, not the Solidity source
- The Z3 model uses unbounded integers — does not model EVM mod-2^256 arithmetic
- Gas is not modeled
- Multi-contract proofs are limited to the cross_contract vocabulary
- The LLM translation layer requires human review
- Default proofs (k=1) are preservation-only (1-step induction): the engine proves invariants are maintained by each modeled transition but does not check initiation against deployment state. Bindings that opt in with `"init": ["all_zero"]` and `"induction": {"k": 2..5}` DO get initiation checking (bounded model checking from the init state to depth k−1 — a base-case violation is reachable by construction) plus a k-inductive step over the full transition relation. Currently a single init predicate (`all_zero`) is supported; k is capped at 5.
- A VIOLATED verdict can mean the invariant is not 1-step inductive rather than a live exploit (counterexample from an unreachable pre-state). Mitigation: strengthen the invariant set with helper invariants and re-run.
- Functions whose guards are unsatisfiable are flagged `vacuous` in solver output; their proofs carry no information.
