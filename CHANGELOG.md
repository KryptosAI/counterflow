# Changelog

All notable changes to Counterflow will be documented in this file.

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
