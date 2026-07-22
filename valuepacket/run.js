#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { runSolver } = require('../src/verify');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
};

const BINDINGS = path.join(__dirname, 'bindings');
const cases = fs.readdirSync(BINDINGS).filter(f => f.endsWith('.binding.json'));

let pass = 0;
let fail = 0;
const rows = [];

for (const f of cases) {
  const binding = JSON.parse(fs.readFileSync(path.join(BINDINGS, f), 'utf-8'));
  const name = f.replace('.binding.json', '');
  const start = Date.now();
  const r = runSolver(binding);
  const ms = Date.now() - start;

  const ok = r.ok && r.output.verdict === 'proved';
  const detail = !r.ok ? r.error : (!ok ? r.output.verdict : '');

  if (ok) pass++; else fail++;
  rows.push({ name, ok, ms, detail, coverage: binding.coverage || null });
}

console.log('');
console.log(`${C.bold}Counterflow → ValuePacket verification${C.reset}`);
console.log(`${C.dim}Pool-level accounting: proven. Channel/escrow/subscription lifecycle: requires model extension (documented).${C.reset}`);
console.log('');
for (const r of rows) {
  const mark = r.ok ? `${C.green}✓ PROVED${C.reset}` : `${C.red}✗ ${r.detail}${C.reset}`;
  const checked = r.coverage ? r.coverage.checked.join(', ') : '';
  console.log(`  ${mark}  ${r.name}  ${C.dim}(${r.ms}ms)${C.reset}`);
  if (checked) console.log(`    ${C.dim}checked: ${checked}${C.reset}`);
  if (r.coverage && r.coverage.not_checked.length) {
    console.log(`    ${C.yellow}not modeled:${C.reset} ${r.coverage.not_checked.slice(0, 3).join('; ')}${r.coverage.not_checked.length > 3 ? '...' : ''}`);
  }
}
console.log('');
console.log(`  ${pass}/${rows.length} PROVED at pool level`);
console.log(`  ${C.yellow}⚠  Full contract verification requires channel/escrow/subscription model extensions.${C.reset}`);
console.log('');

process.exit(fail ? 1 : 0);
