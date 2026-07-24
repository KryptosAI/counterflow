#!/usr/bin/env node
/**
 * Generates the public leaderboard site (docs/) for GitHub Pages:
 * runs every benchmark suite through the solver and renders docs/index.md
 * plus docs/badge.svg. Exits non-zero if ANY expectation fails, so the
 * Pages site is only ever published from a green run.
 */
const fs = require('fs');
const path = require('path');
const { runSolver } = require('../src/verify');

const ROOT = path.join(__dirname, '..');

function checkCase(bindingPath, expectedVerdict, expectedInvariant) {
  if (!fs.existsSync(bindingPath)) return { ok: false, detail: 'binding missing' };
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
  const r = runSolver(binding);
  if (!r.ok) return { ok: false, detail: `solver error: ${r.error}` };
  if (r.output.verdict !== expectedVerdict) {
    return { ok: false, detail: `expected ${expectedVerdict}, got ${r.output.verdict}` };
  }
  if (expectedInvariant) {
    const hit = (r.output.functions || []).some((f) =>
      (f.results || []).some((x) => x.invariant === expectedInvariant && x.status === 'violated'));
    if (!hit) return { ok: false, detail: `expected violation of ${expectedInvariant}` };
  }
  return { ok: true, detail: r.output.verdict };
}

function runSuite(name, cases) {
  return {
    name,
    cases: cases.map((c) => ({ ...c, ...checkCase(c.binding, c.expected_verdict, c.expected_invariant) })),
  };
}

// ── Collect suites ──────────────────────────────────────────────────────
const suites = [];

const benchSuite = JSON.parse(fs.readFileSync(path.join(__dirname, 'suite.json'), 'utf-8'));
suites.push(runSuite('Benchmark suite — exploit classes vs safe references', benchSuite.cases.map((c) => ({
  name: c.name, class: c.class,
  binding: path.resolve(__dirname, c.binding),
  expected_verdict: c.expected_verdict,
  expected_invariant: c.expected_invariant,
}))));

const dhPath = path.join(__dirname, 'defihack', 'suite.json');
if (fs.existsSync(dhPath)) {
  const dh = JSON.parse(fs.readFileSync(dhPath), 'utf-8');
  suites.push(runSuite('DeFiHackLabs reproductions — real exploits, $261M+', dh.cases.map((c) => ({
    name: c.name, class: c.exploit_class,
    binding: path.resolve(__dirname, 'defihack', c.binding),
    expected_verdict: c.expected_verdict,
    expected_invariant: c.expected_invariant,
    loss: c.real_loss_usd,
  }))));
}

suites.push(runSuite('Real contract models', [
  'UniswapV2Swap', 'AaveLending', 'CompoundCToken',
].map((n) => ({
  name: n, class: 'real-contract',
  binding: path.join(ROOT, 'examples', `${n}.binding.json`),
  expected_verdict: 'proved',
}))));

suites.push(runSuite('ValuePacket', [
  'PaymentChannel', 'CrossChainSettlement', 'SubscriptionManager',
].map((n) => ({
  name: n, class: 'valuepacket',
  binding: path.join(ROOT, 'valuepacket', 'bindings', `${n}.binding.json`),
  expected_verdict: 'proved',
}))));

// ── Render ──────────────────────────────────────────────────────────────
const all = suites.flatMap((s) => s.cases);
const passed = all.filter((c) => c.ok).length;
const total = all.length;
const allOk = passed === total;
const ts = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const color = allOk ? 'brightgreen' : 'yellow';
const badgeLabel = `${passed}/${total} verified`;
fs.mkdirSync(path.join(ROOT, 'docs'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'docs', 'badge.svg'),
  `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20"><rect width="70" height="20" fill="#555"/><rect x="70" width="80" height="20" fill="${allOk ? '#4c1' : '#dfb317'}"/><text x="35" y="14" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">counterflow</text><text x="110" y="14" fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle">${badgeLabel}</text></svg>\n`);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const sections = suites.map((s) => {
  const okCount = s.cases.filter((c) => c.ok).length;
  const rows = s.cases.map((c) => {
    const mark = c.ok ? '✅' : '❌';
    const loss = c.loss ? ` ($${(c.loss / 1e6).toFixed(c.loss >= 1e6 ? 1 : 2)}M)` : '';
    return `<tr><td>${mark} ${esc(c.name)}${esc(loss)}</td><td>${esc(c.class)}</td><td>${esc(c.expected_verdict)}</td><td>${esc(c.detail)}</td></tr>`;
  }).join('\n');
  return `<h2>${esc(s.name)} (${okCount}/${s.cases.length})</h2>
<table><thead><tr><th>Case</th><th>Class</th><th>Expected</th><th>Result</th></tr></thead>
<tbody>
${rows}
</tbody></table>`;
}).join('\n');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Counterflow Leaderboard</title>
<style>
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; color: #1a1a1a; }
  h1 { margin-bottom: 0.25rem; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0 1.5rem; font-size: 0.92rem; }
  th, td { border: 1px solid #ddd; padding: 0.35rem 0.6rem; text-align: left; }
  th { background: #f4f4f4; }
  .meta { color: #666; font-size: 0.85rem; }
  a { color: #0969da; }
</style>
</head>
<body>
<h1>Counterflow Leaderboard</h1>
<p><img src="badge.svg" alt="${passed}/${total} verified"></p>
<p>Live verification results — <strong>regenerated by CI on every push to main</strong>.
Every row is a real solver run: safe references must prove, known exploits must
produce a counterexample. <a href="https://github.com/KryptosAI/counterflow">How it works</a></p>
${sections}
<hr>
<p class="meta">${passed}/${total} expectations matched · generated ${ts} by bench/leaderboard-pages.js</p>
</body>
</html>
`;

fs.writeFileSync(path.join(ROOT, 'docs', 'index.html'), html);
console.log(`leaderboard: ${passed}/${total} expectations matched → docs/index.html + docs/badge.svg`);
process.exit(allOk ? 0 : 1);
