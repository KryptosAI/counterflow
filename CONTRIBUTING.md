# Contributing to Counterflow

Thank you for contributing. Counterflow is open core (MIT) — the CLI, the Z3 solver, the benchmark
suite, and the GitHub Action all live here. The commercial layer is separate.

## Quick start

```bash
npm install        # zero npm dependencies; everything is built-in Node
pip install z3-solver   # the trusted solver core
counterflow doctor      # check all deps
npm test                # 35/35 e2e tests
npm run bench           # 16/16 solver cases
node src/cli.js bytecode --expect  # 9/9 Halmos scenarios
```

## Areas to contribute

| Area | Difficulty | Where |
|---|---|---|
| Binding examples | Easy | `examples/` — model a new contract with an existing vocabulary |
| Exploit reproductions | Easy | `bench/` — add a DeFiHackLabs case or a synthetic exploit binding |
| Vocabulary extensions | Medium | `solver/models.py` — add a guard, effect, or invariant; sync `src/translate.js` |
| Bytecode scenarios | Medium | `halmos/test/HalmosTest.t.sol` — add a new symbolic test; register in `halmos/expectations.json` |
| CLI / tooling | Medium | `src/` — new subcommands, reports, integrations |
| Trusted core | Hard | `solver/models.py` — changes to the induction engine or model types; requires review |

## Process

1. Fork the repo
2. Create a branch
3. Add tests (e2e or bench cases)
4. Run `npm test && npm run bench` — both must pass
5. Add a line to `CHANGELOG.md`
6. Open a PR

Pull requests without tests will be asked to add them. The benchmark suite and leaderboard
gate are CI-enforced — anything that breaks a known-safe binding will fail the build.

## Binding syntax

A binding is a JSON file describing a smart contract's functions (guards + effects) and
invariants. All guards, effects, and invariants must be from the closed vocabulary. Run
`counterflow check binding.json` to get a verdict.

See `examples/TokenPool.binding.json` for the simplest example:

```json
{
  "model": "erc20_pool",
  "functions": [
    { "name": "deposit", "guards": ["amt_gt_0"], "effects": ["bal_add_amt", "total_add_amt"] },
    { "name": "withdraw", "guards": ["amt_gt_0", "bal_ge_amt"], "effects": ["bal_sub_amt", "total_sub_amt"] }
  ],
  "invariants": ["nonneg_balance", "nonneg_total", "solvency"]
}
```

## Vocabulary reference

The full vocabulary: **31 guards, 43 effects, 33 invariants** — see `src/translate.js` (the JS arrays)
and `solver/models.py` (the Python semantics). The JS arrays are the LLM-facing gate; the Python
dicts are the trusted implementation. They are kept in sync by the e2e vocabulary parity test.

## License

MIT. By contributing, you agree that your work will be licensed under the MIT license.
