const fs = require('fs');
const path = require('path');
const { verifyChain, LOG_PATH } = require('./audit');

function loadEntries() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function dashboardHtml() {
  const entries = loadEntries();
  const chain = verifyChain();

  const proved = entries.filter(e => e.verdict === 'proved').length;
  const violated = entries.filter(e => e.verdict === 'violated').length;
  const errors = entries.filter(e => e.verdict === 'error').length;
  const total = entries.length;

  const barWidth = (n) => total > 0 ? Math.round((n / total) * 300) : 0;

  const rows = entries.map((e, i) => {
    const model = (e.binding ? (() => { try { return JSON.parse(e.binding).model; } catch { return ''; } })() : '') || '';
    const contract = e.contract_path || '';
    const ts = e.timestamp || '';
    const dur = e.duration_ms || 0;
    const v = e.verdict;
    const color = v === 'proved' ? '#4c1' : v === 'violated' ? '#e05d44' : '#9f9f9f';
    return `<tr>
      <td>${i + 1}</td>
      <td>${contract.replace(/.*\//, '')}</td>
      <td>${model}</td>
      <td style="color:${color};font-weight:700">${v.toUpperCase()}</td>
      <td>${dur}ms</td>
      <td style="font-size:11px">${ts.slice(0, 19)}</td>
    </tr>`;
  }).join('\n');

  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Counterflow Dashboard</title>
<style>
  body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:2rem}
  h1{color:#58a6ff}.bar{height:24px;display:inline-block;border-radius:3px;margin:0 2px}
  .pass{background:#238636}.fail{background:#da3633}.err{background:#6e7681}
  table{border-collapse:collapse;width:100%;margin-top:1rem}
  th,td{padding:6px 12px;text-align:left;border-bottom:1px solid #21262d}
  th{color:#8b949e;font-size:12px}td{font-size:13px}
  .chain-ok{color:#238636}.chain-bad{color:#da3633}
  .summary{display:flex;gap:2rem;margin:1rem 0}
</style></head><body>
<h1>Counterflow Dashboard</h1>
<div class="summary">
<div><strong>${total}</strong> runs</div>
<div style="color:#238636"><strong>${proved}</strong> proved</div>
<div style="color:#da3633"><strong>${violated}</strong> violated</div>
<div style="color:#6e7681"><strong>${errors}</strong> errors</div>
<div>Chain: <span class="${chain.valid ? 'chain-ok' : 'chain-bad'}">${chain.valid ? 'VALID' : 'BROKEN'}</span></div>
</div>
<div>
  <span class="bar pass" style="width:${barWidth(proved)}px" title="${proved} proved"></span>
  <span class="bar fail" style="width:${barWidth(violated)}px" title="${violated} violated"></span>
  <span class="bar err" style="width:${barWidth(errors)}px" title="${errors} errors"></span>
</div>
<table><thead><tr><th>#</th><th>Contract</th><th>Model</th><th>Verdict</th><th>Dur</th><th>Timestamp</th></tr></thead>
<tbody>${rows}</tbody></table>
</body></html>`;
}

module.exports = { dashboardHtml, loadEntries };
