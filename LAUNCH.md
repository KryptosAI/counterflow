# Counterflow Launch Checklist

Everything below is ready to paste. Facts are synced to v0.5.1 (2026-07-23).

## Assets

- `BLOG.md` — long-form article (dev.to / Medium / personal blog)
- `REDDIT.md` — comparison-heavy post (Reddit)
- `THREAD.md` — 6-tweet X/Twitter thread (GitHub Action launch angle)

## 1. GitHub Marketplace (1 manual step)

- [ ] Open https://github.com/KryptosAI/counterflow-action/releases/tag/v1.0.0
- [ ] Edit release → check **"Publish this Action to the GitHub Marketplace"** (one-time terms acceptance; cannot be done via API) → save

## 2. dev.to (or Medium)

- [ ] New post, paste `BLOG.md`
- Title: `Counterflow — Prove the Contract, or Reveal the Exploit (now in your CI)`
- Tags: `web3`, `solidity`, `security`, `ethereum`
- Canonical URL: https://github.com/KryptosAI/counterflow

## 3. Reddit

Suggested titles:

- r/ethdev: `Counterflow v0.5.1 — LLM-translated, Z3-proved invariant checking, now as a GitHub Action (MIT)`
- r/smartcontracts: `Prove the contract, or reveal the exploit — open-source Z3 invariant verification with a GitHub Action`
- r/solidity: cross-post of the r/ethdev title

- [ ] Paste `REDDIT.md` (it leads with the Action snippet and ends with honest limitations — keep those, they drive the best comments)
- Timing: Tue–Thu, 14:00–17:00 UTC (US morning)

## 4. Show HN

- [ ] Title: `Show HN: Counterflow – Z3-proved smart contract invariants as a GitHub Action`
- URL: https://github.com/KryptosAI/counterflow
- First comment (post immediately after submitting): 2-3 sentences from BLOG.md ("The LLM never decides the verdict…") + the leaderboard link. Timing: Tue–Thu, 14:00–16:00 UTC.

## 5. X/Twitter

- [ ] Post `THREAD.md` as a 6-tweet thread. Suggested time: 15:00–17:00 UTC.
- Pin tweet 1.

## 6. KPIs to watch (baseline: ~0)

- npm downloads: https://www.npmjs.com/package/@kryptosai/counterflow
- Stars: https://github.com/KryptosAI/counterflow
- Action usage: https://github.com/KryptosAI/counterflow-action/network/dependents

## Notes

- Do NOT buy ads or bot stars — the leaderboard/CI receipts are the pitch; authenticity compounds.
- Best follow-up content after launch: a "the leaderboard caught our own stale claim" post (already in REDDIT.md) — vulnerability about process performs well.
