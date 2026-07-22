const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function badge(verdict) {
  if (verdict === 'proved') return `${C.green}${C.bold} PROVED ${C.reset}`;
  if (verdict === 'violated') return `${C.red}${C.bold} VIOLATED ${C.reset}`;
  if (verdict === 'unknown') return `${C.yellow}${C.bold} UNKNOWN ${C.reset}`;
  return `${C.red}${C.bold} ERROR ${C.reset}`;
}

function renderCex(c) {
  const lines = [];
  const call = `actor=${c.actor}${c.to !== undefined ? ` to=${c.to}` : ''}${c.src !== undefined ? ` src=${c.src}` : ''} amt=${c.amt}`;
  lines.push(`        ${C.dim}call :${C.reset} ${call}`);
  const pairs = Object.entries(c).filter(([k]) => k.endsWith('_pre'));
  const pre = [];
  const post = [];
  for (const [k, v] of pairs) {
    const name = k.replace(/_pre$/, '');
    const pv = c[`${name}_post`];
    if (v === pv || pv === undefined) continue;
    pre.push(`${name}=${v}`);
    const negative = typeof pv === 'string' && pv.startsWith('-');
    post.push(`${name}=${negative ? C.red + pv + C.reset : pv}`);
  }
  if (pre.length) {
    lines.push(`        ${C.dim}pre  :${C.reset} ${pre.join(', ')}`);
    lines.push(`        ${C.dim}post :${C.reset} ${post.join(', ')}`);
  }
  return lines;
}

function render(result) {
  const lines = [];
  lines.push('');
  lines.push(`${C.bold}Counterflow${C.reset} ${C.dim}— Prove the contract, or reveal the exploit.${C.reset}`);
  lines.push('');

  if (result.stage !== 'complete') {
    lines.push(`${badge('error')} at stage: ${C.bold}${result.stage}${C.reset}`);
    lines.push(`  ${C.red}${result.error}${C.reset}`);
    if (result.details) {
      for (const d of result.details) lines.push(`    - ${d}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Result: ${badge(result.verdict)}`);
  lines.push(`${C.dim}contract sha256:${C.reset} ${result.contractSha256.slice(0, 16)}…`);
  lines.push(`${C.dim}binding source:${C.reset} ${result.bindingSource}` +
    (result.llmUsage ? ` (${result.llmUsage.provider}/${result.llmUsage.model}, ${result.llmUsage.inputTokens}+${result.llmUsage.outputTokens} tok)` : ''));
  if (result.solver.proof) {
    const p = result.solver.proof;
    lines.push(`${C.dim}proof:${C.reset} ${p.kind === 'k-induction' ? `k-induction (k=${p.k}, init: ${(p.init || []).join(', ')})` : '1-induction'}`);
  }
  lines.push('');

  if (Array.isArray(result.solver.invariants)) {
    for (const r of result.solver.invariants) {
      if (r.status === 'proved') {
        lines.push(`    ${C.green}✓ proved${C.reset}   ${r.invariant} ${C.dim}(base held, step passed)${C.reset}`);
      } else if (r.status === 'violated') {
        const where = r.base && r.base.violated_at_depth !== undefined
          ? `base case, depth ${r.base.violated_at_depth} (reachable from init)`
          : 'inductive step';
        lines.push(`    ${C.red}✗ violated${C.reset} ${r.invariant} ${C.dim}— ${where}${C.reset}`);
        lines.push(...renderCex(r.counterexample));
      } else {
        lines.push(`    ${C.yellow}? unknown${C.reset}  ${r.invariant}`);
      }
    }
    lines.push('');
  }

  for (const fn of result.solver.functions) {
    lines.push(`  ${C.cyan}${C.bold}${fn.function}()${C.reset}`);
    if (fn.vacuous === true) {
      lines.push(`    ${C.yellow}⚠ vacuous — guards unsatisfiable; proofs are vacuous${C.reset}`);
    }
    for (const r of fn.results || []) {
      if (r.status === 'proved') {
        lines.push(`    ${C.green}✓ proved${C.reset}   ${r.invariant}`);
      } else if (r.status === 'violated') {
        lines.push(`    ${C.red}✗ violated${C.reset} ${r.invariant}`);
        lines.push(...renderCex(r.counterexample));
      } else {
        lines.push(`    ${C.yellow}? unknown${C.reset}  ${r.invariant}`);
      }
    }
  }
  lines.push('');
  lines.push(`${C.dim}audit entry:${C.reset} ${result.auditEntryId}  ${C.dim}(${result.durationMs}ms)${C.reset}`);
  lines.push('');
  return lines.join('\n');
}

module.exports = { render, badge };
