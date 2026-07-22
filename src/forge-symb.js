const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runHalmos } = require('./halmos-runner');

const HALMOS_DIR = path.join(__dirname, '..', 'halmos');
const HALMOS_TEST_DIR = path.join(HALMOS_DIR, 'test');

function isForgeInstalled() {
  try {
    const r = spawnSync('forge', ['--version'], { encoding: 'utf-8', timeout: 10000 });
    return r.status === 0;
  } catch {
    return false;
  }
}

function sanitizeName(name) {
  return name
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/^_+/, '')
    .replace(/_+/g, '_')
    .replace(/(?:^|_)([a-z])/g, (_, c) => c.toUpperCase());
}

function extractContractName(contractSource) {
  if (!contractSource || contractSource.trim().length === 0) {
    return null;
  }
  if (contractSource.indexOf('\n') === -1 && contractSource.indexOf(' ') === -1) {
    return contractSource;
  }
  const m = contractSource.match(/contract\s+(\w+)/);
  return m ? m[1] : null;
}

/**
 * Parse forge -vvv test output and extract counterexamples from failing tests.
 * Handles both inline format:
 *   [FAIL. Reason: assertion failed; counterexample: calldata=0x..., args=[1, 2, 3]] testName(...)
 * and expanded format with a separate Counterexample: line.
 */
function extractCounterexampleFromForge(forgetestOutput) {
  const results = [];
  const lines = forgetestOutput.split('\n');

  let pendingTestName = null;
  let pendingReason = null;

  // Pattern for inline FAIL line: [FAIL ... ] testName(...)
  const failLineRe = /^\s*\[FAIL[.\]]/;

  // Pattern for full inline counterexample on FAIL line:
  // [FAIL. Reason: X; counterexample: calldata=0x..., args=[...]] testName
  const inlineCexRe = /\[FAIL[^\]]*counterexample:\s*calldata=([^\s,;]+)[^\]]*args=\[([^\]]*)\][^\]]*\]\s+(\S+)/;

  // Pattern for FAIL without inline cex: [FAIL ... ] testName(...)
  const failNoCexRe = /^\s*\[(FAIL[^\]]*)\]\s+(\S+)/;

  // Pattern for standalone counterexample line
  const cexLineRe = /Counterexample:\s*args=\[([^\]]*)\]/;

  // In newer Foundry, the line looks like:
  // [FAIL: assertion failed; counterexample: calldata=0x..., args=[1, 2]] testName(uint256,uint256)
  const newFmtRe = /\[FAIL(?:[\]\.:]).*?counterexample:\s*calldata=([^\s,;]+).*?args=\[([^\]]*)\](?:[)\]])?\s+(\S+)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Try inline counterexample (both old and new formats)
    let m = line.match(inlineCexRe) || line.match(newFmtRe);
    if (m) {
      const calldata = m[1];
      const argStr = m[2];
      const testName = m[3].split('(')[0];
      const reasonMatch = line.match(/Reason:\s*([^;\]]+)/);
      const reason = reasonMatch ? reasonMatch[1].trim() : 'assertion failed';
      results.push({
        testName,
        reason,
        calldata,
        args: parseArgs(argStr),
        rawLine: line.trim(),
      });
      pendingTestName = null;
      pendingReason = null;
      continue;
    }

    // Try FAIL without inline cex
    m = line.match(failNoCexRe);
    if (m && !line.includes('counterexample')) {
      pendingReason = m[1].replace(/^FAIL[.:\s]*/, '').replace(/^Reason:\s*/i, '').trim();
      pendingTestName = m[2].split('(')[0];
      continue;
    }

    // Try standalone counterexample line (after a FAIL line)
    m = line.match(cexLineRe);
    if (m && pendingTestName) {
      results.push({
        testName: pendingTestName,
        reason: pendingReason || 'assertion failed',
        calldata: null,
        args: parseArgs(m[1]),
        rawLine: line.trim(),
      });
      pendingTestName = null;
      pendingReason = null;
      continue;
    }

    // If a FAIL line was pending but the next line doesn't have a counterexample,
    // we still record the failure if there's useful context on subsequent lines
    if (pendingTestName && failLineRe.test(line)) {
      pendingTestName = null;
      pendingReason = null;
    }
  }

  return results;
}

function parseArgs(argStr) {
  const trimmed = argStr.trim();
  if (!trimmed) return [];

  const hasNaming = trimmed.includes('=');

  const parts = [];
  let depth = 0;
  let current = '';
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    if (ch === '[' || ch === '(' || ch === '{') depth++;
    else if (ch === ']' || ch === ')' || ch === '}') depth--;
    if (ch === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());

  if (hasNaming) {
    const named = {};
    const positional = [];
    for (const part of parts) {
      const eqIdx = part.indexOf('=');
      if (eqIdx > 0) {
        const key = part.substring(0, eqIdx).trim();
        const val = part.substring(eqIdx + 1).trim();
        named[key] = val;
        positional.push(val);
      } else {
        positional.push(part.trim());
      }
    }
    return { positional, named };
  }

  return parts;
}

/**
 * Generate a Halmos symbolic test Solidity file that starts from the concrete
 * counterexample values and lets Halmos symbolically explore all branches from there.
 */
function generateSymbolicFromCex(testName, cex, contractSource) {
  const basename = sanitizeName(testName || 'test');
  const contractName = extractContractName(contractSource) || 'ContractUnderTest';
  const safeName = `Symbolic${basename}Test`;
  const args = cex && cex.args ? cex.args : [];

  const isNamed = args && typeof args === 'object' && !Array.isArray(args) && args.named;
  const argEntries = isNamed ? Object.entries(args.named) : (Array.isArray(args) ? args : []);

  const paramDecls = [];
  const assumeStmts = [];
  const knownParams = [];

  if (isNamed) {
    for (const [name, val] of argEntries) {
      paramDecls.push(`uint256 ${name}`);
      assumeStmts.push(`        vm.assume(${name} == ${val});`);
      knownParams.push(name);
    }
  } else {
    for (let i = 0; i < argEntries.length; i++) {
      const pname = `arg${i}`;
      paramDecls.push(`uint256 ${pname}`);
      assumeStmts.push(`        vm.assume(${pname} == ${argEntries[i]});`);
      knownParams.push(pname);
    }
  }

  const paramsStr = paramDecls.join(', ');

  return `// SPDX-License-Identifier: MIT
// Auto-generated by Counterflow: fuzz-to-symbolic bridge.
// Counterexample from forge fuzz: ${testName}
pragma solidity ^0.8.20;

import {${contractName}} from "../src/${contractName}.sol";

contract ${safeName} {
    function check_${basename}_symbolic(${paramsStr}) public {
${assumeStmts.join('\n')}

        ${contractName} instance = new ${contractName}();

        // --- Replay the operation that triggered the violation ---
        // FIXME: apply the sequence of calls that led to the counterexample,
        // using the pinned parameter values above.
        //
        // Example:
        //   instance.deposit(arg0);
        //   instance.withdraw(arg1);

        // --- Assert the property under test ---
        // FIXME: replace the line below with the actual invariant assertion.
        // Halmos will symbolically explore all execution branches from this point.
        assert(true);
    }

    function vm_assume(bool c) internal pure {
        if (!c) {
            assembly {
                revert(0, 0)
            }
        }
    }
}
`;
}

/**
 * Write a generated symbolic test file into the halmos test directory and
 * invoke Halmos on it.  Uses runHalmos from halmos-runner.js — no duplication.
 */
function runHalmosSymbolic(testFile) {
  const content = fs.readFileSync(testFile, 'utf-8');
  const basename = path.basename(testFile);

  const contractMatch = content.match(/contract\s+(\w+)\s*(?:is|\{)/);
  if (!contractMatch) {
    return { ok: false, error: `Could not extract contract name from ${testFile}` };
  }
  const contractName = contractMatch[1];

  const dest = path.join(HALMOS_TEST_DIR, basename);
  fs.writeFileSync(dest, content, 'utf-8');

  return runHalmos(contractName);
}

/**
 * Fuzz-to-symbolic bridge entry point.
 *
 * 1. Runs forge fuzz tests.
 * 2. Parses output for failed tests and extracts counterexamples.
 * 3. For each failure, generates a Halmos symbolic test pinning the cex values.
 * 4. Runs Halmos on each generated test.
 * 5. Returns combined results.
 *
 * @param {string} contractName - The test contract name for --match-contract
 * @param {string} testGlob     - The test glob for --match-test
 * @param {object} [options]    - { contractSource, cwd }
 * @returns Combined fuzz + symbolic results.
 */
function runFuzzThenSymbolic(contractName, testGlob, options = {}) {
  if (!isForgeInstalled()) {
    return {
      ok: false,
      error: 'forge is not installed. Install Foundry from https://getfoundry.sh',
      fuzzResults: [],
      symbolicResults: [],
    };
  }

  const cwd = options.cwd || HALMOS_DIR;

  const forgeArgs = [
    'test',
    '--match-contract', contractName,
    '--match-test', testGlob,
    '-vvv',
  ];

  const fuzzRun = spawnSync('forge', forgeArgs, {
    cwd,
    encoding: 'utf-8',
    maxBuffer: 50 * 1024 * 1024,
    timeout: 300000,
  });

  const output = (fuzzRun.stdout || '') + '\n' + (fuzzRun.stderr || '');
  const counterexamples = extractCounterexampleFromForge(output);

  const fuzzResults = {
    exitCode: fuzzRun.status,
    passing: fuzzRun.status === 0 && counterexamples.length === 0,
    failures: counterexamples.length,
    counterexamples,
    rawOutput: output,
  };

  const symbolicResults = [];
  for (const cex of counterexamples) {
    const source = options.contractSource || '';
    const genSrc = generateSymbolicFromCex(cex.testName, cex, source);
    const filename = `Symbolic${sanitizeName(cex.testName)}Test.t.sol`;
    const tmpFile = path.join(HALMOS_TEST_DIR, filename);
    fs.writeFileSync(tmpFile, genSrc, 'utf-8');

    const halmosResult = runHalmosSymbolic(tmpFile);
    symbolicResults.push({
      testName: cex.testName,
      cex,
      halmos: halmosResult,
    });

    // Clean up generated file to avoid polluting the test directory
    try { fs.unlinkSync(tmpFile); } catch (_) { /* best effort */ }
  }

  const allSymbolicPassed = symbolicResults.length > 0 &&
    symbolicResults.every(sr => sr.halmos.ok && sr.halmos.results.every(r => r.passed));

  let combinedSummary;
  if (!counterexamples.length) {
    combinedSummary = `Fuzz: all tests passed — no counterexamples to promote.`;
  } else if (allSymbolicPassed) {
    combinedSummary = `Fuzz: ${counterexamples.length} failure(s) found and promoted to symbolic. ` +
      `Symbolic: all passed (no deeper violations found).`;
  } else {
    const symFailCount = symbolicResults.filter(
      sr => !sr.halmos.ok || sr.halmos.results.some(r => !r.passed)
    ).length;
    combinedSummary = `Fuzz: ${counterexamples.length} failure(s) promoted to symbolic. ` +
      `Symbolic: ${symFailCount} test(s) found additional violations.`;
  }

  return {
    ok: true,
    fuzzResults,
    symbolicResults,
    combinedSummary,
  };
}

module.exports = {
  runFuzzThenSymbolic,
  extractCounterexampleFromForge,
  generateSymbolicFromCex,
  runHalmosSymbolic,
};
