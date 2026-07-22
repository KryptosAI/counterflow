const fs = require('fs');
const { LOG_PATH } = require('./audit');

function loadEntries() {
  if (!fs.existsSync(LOG_PATH)) return [];
  return fs.readFileSync(LOG_PATH, 'utf-8').trim().split('\n').filter(Boolean).map(JSON.parse);
}

function leaderboardData() {
  const entries = loadEntries();
  return entries.map((e, i) => ({
    rank: i + 1,
    contract: (e.contract_path || '').replace(/.*\//, '').replace(/\.(binding\.json|sol)$/, ''),
    model: (() => { try { return e.binding ? JSON.parse(e.binding).model : ''; } catch { return ''; } })(),
    verdict: e.verdict,
    invariants: (() => { try { if (e.binding) { const b = JSON.parse(e.binding); return (b.invariants || []).length; } } catch { return 0; } return 0; })(),
    functions: (() => { try { if (e.binding) { const b = JSON.parse(e.binding); return (b.functions || []).length; } } catch { return 0; } return 0; })(),
    durationMs: e.duration_ms || 0,
    timestamp: e.timestamp || '',
    hash: e.hash || '',
  }));
}

function renderText(data) {
  const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', red: '\x1b[31m' };
  const lines = [''];
  lines.push(`${C.bold}Counterflow Leaderboard${C.reset}`);
  lines.push('');
  for (const r of data) {
    const mark = r.verdict === 'proved' ? `${C.green}PROVED ${C.reset}` : `${C.red}VIOLATED${C.reset}`;
    lines.push(`  ${C.dim}${r.rank}.${C.reset} ${r.contract}  ${mark}  ${C.dim}${r.invariants} invs, ${r.functions} fns  ${r.timestamp?.slice(0, 10)}  ${r.durationMs}ms${C.reset}`);
  }
  lines.push('');
  lines.push(`${C.dim}Total: ${data.length} verification runs${C.reset}`);
  return lines.join('\n');
}

function renderMarkdown(data) {
  const lines = ['# Counterflow Leaderboard', '', '| # | Contract | Model | Verdict | Invariants | Functions | Duration | Date |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of data) {
    lines.push(`| ${r.rank} | ${r.contract} | ${r.model} | ${r.verdict} | ${r.invariants} | ${r.functions} | ${r.durationMs}ms | ${r.timestamp?.slice(0, 10)} |`);
  }
  return lines.join('\n');
}

module.exports = { leaderboardData, loadEntries, renderText, renderMarkdown };
