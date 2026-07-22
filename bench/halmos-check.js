#!/usr/bin/env node
/**
 * Halmos expectations check — runs the HalmosTest suite and compares results
 * against halmos/expectations.json. Exit 0 iff every expectation matches.
 * Safe references must PASS; known exploits must FAIL with a counterexample.
 */
const fs = require('fs');
const path = require('path');
const { runHalmos } = require('../src/halmos-runner');
const { compareExpectations } = require('../src/halmos-expect');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m',
};

const expPath = path.join(__dirname, '..', 'halmos', 'expectations.json');
const exp = JSON.parse(fs.readFileSync(expPath, 'utf-8'));

console.log('');
console.log(`${C.bold}Counterflow Halmos expectations check${C.reset} ${C.dim}(${exp.scenarios.length} scenarios, halmos ${exp.halmos_version})${C.reset}`);
console.log('');

const r = runHalmos('*');
if (!r.ok) {
  console.error(`${C.red}halmos error: ${r.error}${C.reset}`);
  process.exit(2);
}

const { ok, matches, mismatches } = compareExpectations(exp.scenarios, r.results);

for (const m of matches) {
  console.log(`  ${C.green}✓${C.reset} ${m.name}  ${C.dim}[${m.class}] ${m.outcome}${C.reset}`);
}
for (const m of mismatches) {
  console.log(`  ${C.red}✗${C.reset} ${m.name}`);
  console.log(`      ${C.red}${m.problem}${C.reset}`);
  if (m.counterexample) {
    console.log(`      ${C.dim}cex: ${JSON.stringify(m.counterexample)}${C.reset}`);
  }
}
console.log('');
console.log(`  ${matches.length}/${matches.length + mismatches.length} expectations matched`);
console.log('');
process.exit(ok ? 0 : 1);
