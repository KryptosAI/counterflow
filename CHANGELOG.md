# Changelog

All notable changes to Counterflow will be documented in this file.

## [0.5.0] — 2026-07-22

### Added

- **K-induction (opt-in)**: bindings may add `"init": ["all_zero"]` and `"induction": {"k": 2}` (k ≤ 5). The solver then checks initiation by bounded model checking from a zero deploy state (a base-case violation is a *reachable* exploit, reported with its depth) and proves the step over k linked transitions of the full multi-function transition relation. Default k=1 is byte-identical to previous behavior. Output carries `proof` metadata for both modes.
- **Halmos expectations harness**: `halmos/expectations.json` is the versioned registry of the 9 bytecode scenarios (3 safe references must PASS, 6 exploits must FAIL with a counterexample). `counterflow bytecode --expect` / `bench/halmos-check.js` gates on it: regressions, lost trophies, and unregistered scenarios all fail the check. Runs in CI as a required job.
- `serve --port 0` support (OS-assigned ephemeral port; CLI prints the actual bound port) plus a clean EADDRINUSE error.
- e2e: 9 new tests (halmos comparator ×4, k-induction ×5) and the serve test now uses an ephemeral port — 35/35 pass.

### Fixed

- `runHalmos('*')` passed a literal `*` to halmos's regex contract filter, silently producing zero results; `*`/empty now omits the filter (runs all test contracts).
- Halmos counterexample parsing: halmos prints the cex block *before* the `[FAIL]` line; vars were mis-attributed to the previous result. Parser now buffers and attaches correctly.

## [0.4.2] — 2026-07-22

### Fixed

- `postinstall` shell-quoting bug that made `npm install @kryptosai/counterflow` fail: backticks in the message were interpreted as shell command substitution by npm's `sh -c` wrapper. Message is now single-quote-safe. 0.4.1 installs were broken; use 0.4.2+.

## [0.4.1] — 2026-07-22

### Added

- CI-safe `postinstall` hint pointing new users at `counterflow doctor` (silently exits when `CI` is set, output is not a TTY, or `COUNTERFLOW_SKIP_POSTINSTALL` is set)
- e2e coverage: `completeness` scoring tests (covered/uncovered/graceful-failure) and a `serve` dashboard `/health` smoke test — 26/26 tests pass
- TROPHIES.md: added OracleManipulation (`oracle_integrity`) and GovernanceNoTimelock (`solvency`) trophy rows, completing the 16-case synthetic benchmark table

## [0.4.0] — 2026-07-21

### State Model (5 types)

- `erc20_pool` — ERC-20 token pools with balances, shares, allowances, ghost sums
- `amm_pool` — constant-product AMMs with reserves, LP supply, liquidity tracking
- `lending_pool` — overcollateralized lending with collateral, debt, health checks
- `staking_pool` — staking and reward distribution with reward pool accounting
- `cross_contract` — cross-contract calls with snapshot validation

### Vocabulary

- 27 guards (ownership, balance checks, reentrancy lock, cross-contract flags, health checks, oracle price/twap, governance timelock)
- 43 effects (transfers, mint/burn, reentrancy lock acquire/release, cross-contract calls, oracle updates, proposal execution)
- 33 invariants (non-negativity, integrity, solvency, backing, reentrancy safety, cross-contract safety, oracle integrity/price stability, timelock)

### Verdict Coverage

- 16/16 benchmark cases correct (safe references + known exploit variants, incl. oracle manipulation and governance timelock cases)
- 5/5 DeFiHackLabs cases reproduced ($261M+ total loss):
  - FEI Protocol ($80M) — reentrancy
  - CREAM Finance ($130M) — ERC777 reentrancy
  - PancakeBunny ($45M) — flash loan
  - OpenLeverage ($230K) — access control
  - Belt Finance ($6.3M) — arithmetic underflow
- 3/3 real contract models proved: Uniswap V2 Swap, Aave Lending, Compound cToken
- 9/9 Halmos bytecode tests: 3 PASS / 6 FAIL confirming exploit patterns

### New CLI Commands

- `doctor` — check all dependencies (Python 3, z3-solver, Halmos, Foundry)
- `leaderboard` — display verified contracts from the audit log
- `badge` — generate a verification badge
- `serve` — launch the audit dashboard
- `completeness` — check vocabulary coverage of a binding
- `mutate` — mutation testing against the vocabulary

### New Documentation

- `TROPHIES.md` — catalog of all vulnerabilities caught by Counterflow
- `LEADERBOARD.md` — ranked list of verified contracts
- `SECURITY.md` — trust model, what PROVED means, reporting process

### CLI Enhancements

- SHA-256 hash-chained audit log (`audit.jsonl`)
- `verify` command: full AI pipeline (LLM translate → validate → Z3 prove)
- `export` command: Foundry test generation from bindings
- `bytecode` command: Halmos EVM symbolic execution as bytecode backstop
- `--version` flag prints the package version
- Solver vacuity warnings: functions with unsatisfiable guard sets are flagged `vacuous` (their proofs would be vacuous)
- ValuePacket verification suite: 3/3 at pool level

### CI / Tests

- GitHub Actions workflow (`.github/workflows/ci.yml`) runs `npm test` and `npm run bench` on Node 18, 20, and 22
- Expanded e2e suite: audit-chain tamper detection, JS/Python vocabulary parity, CLI smoke, and module smoke tests

### Package

- `files` field restricts publish to source directories only
- `publishConfig` for public scoped access
- Node >=18 required
