#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { runSolver } = require('../src/verify');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
};

const suite = JSON.parse(fs.readFileSync(path.join(__dirname, 'suite.json'), 'utf-8'));

let pass = 0;
let fail = 0;
let skip = 0;
const rows = [];

for (const c of suite.cases) {
  const bindingPath = path.resolve(__dirname, c.binding);
  if (!fs.existsSync(bindingPath)) {
    skip++;
    rows.push({ name: c.name, class: c.class, ok: false, ms: 0, detail: 'binding file missing' });
    continue;
  }
  const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
  const start = Date.now();
  const r = runSolver(binding);
  const ms = Date.now() - start;

  let ok = false;
  let detail = '';
  if (!r.ok) {
    detail = `solver error: ${r.error}`;
  } else if (r.output.verdict !== c.expected_verdict) {
    detail = `expected ${c.expected_verdict}, got ${r.output.verdict}`;
  } else if (c.expected_invariant) {
    const hit = r.output.functions.some((f) =>
      f.results.some((x) => x.invariant === c.expected_invariant && x.status === 'violated'));
    ok = hit;
    if (!hit) detail = `expected violation of ${c.expected_invariant}, not found`;
  } else {
    ok = true;
  }

  if (ok) pass++; else fail++;
  rows.push({ name: c.name, class: c.class, ok, ms, detail });
}

console.log('');
console.log(`${C.bold}Counterflow benchmark${C.reset} ${C.dim}(deterministic, reviewed bindings, no LLM)${C.reset}`);
console.log('');
for (const r of rows) {
  if (r.detail === 'binding file missing') {
    console.log(`  ${C.yellow}⊘${C.reset} ${r.name}  ${C.dim}[${r.class}] SKIPPED${C.reset}`);
  } else {
    const mark = r.ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
    console.log(`  ${mark} ${r.name}  ${C.dim}[${r.class}]${C.reset}${r.detail ? `\n      ${C.red}${r.detail}${C.reset}` : ''}  ${C.dim}(${r.ms}ms)${C.reset}`);
  }
}
console.log('');
console.log(`  ${pass}/${pass + fail} correct${skip > 0 ? `  (${skip} skipped)` : ''}`);
console.log('');
process.exit(fail > 0 ? 1 : 0);
