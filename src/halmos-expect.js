/**
 * Compare actual Halmos results against halmos/expectations.json.
 *
 * Pure function — no halmos dependency, fully unit-testable.
 *
 * Outcomes per scenario:
 *   expect pass + passed                → match
 *   expect fail + failed (with cex)     → match (exploit stays reproducible)
 *   expect fail + failed (no cex)       → mismatch (unverifiable failure)
 *   expect pass + failed                → mismatch (REGRESSION)
 *   expect fail + passed                → mismatch (LOST TROPHY)
 *   name only in expectations           → mismatch (missing scenario)
 *   name only in results                → mismatch (unregistered scenario)
 */

function stripSig(name) {
  // halmos prints e.g. "check_Foo_bar(uint256,uint256)" — expectations use bare names
  return String(name).replace(/\(.*$/, '');
}

function compareExpectations(expectedScenarios, actualResults) {
  const matches = [];
  const mismatches = [];
  const actualByName = new Map(actualResults.map((r) => [stripSig(r.name), r]));
  const expectedNames = new Set();

  for (const e of expectedScenarios) {
    const key = stripSig(e.name);
    expectedNames.add(key);
    const a = actualByName.get(key);
    if (!a) {
      mismatches.push({ name: key, problem: 'expected scenario not found in halmos results' });
      continue;
    }
    if (e.expect === 'pass') {
      if (a.passed) {
        matches.push({ name: key, outcome: 'pass', class: e.class });
      } else {
        mismatches.push({ name: key, problem: 'REGRESSION: expected PASS but halmos FAILED', counterexample: a.counterexample });
      }
    } else if (!a.passed) {
      const hasCex = a.counterexample && Object.keys(a.counterexample).length > 0;
      if (hasCex) {
        matches.push({ name: key, outcome: 'fail (exploit reproduced)', class: e.class });
      } else {
        mismatches.push({ name: key, problem: 'expected FAIL with counterexample but failed without one' });
      }
    } else {
      mismatches.push({ name: key, problem: 'LOST TROPHY: expected FAIL (exploit) but halmos PASSED — investigate halmos/contract changes' });
    }
  }

  for (const r of actualResults) {
    const key = stripSig(r.name);
    if (!expectedNames.has(key)) {
      mismatches.push({ name: key, problem: 'unregistered halmos scenario — add it to halmos/expectations.json' });
    }
  }

  return { ok: mismatches.length === 0, matches, mismatches };
}

module.exports = { compareExpectations, stripSig };
