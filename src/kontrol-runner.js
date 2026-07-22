const { spawnSync } = require('child_process');
const path = require('path');

function checkKontrol() {
  const r = spawnSync('kontrol', ['--version'], {
    encoding: 'utf-8',
    timeout: 10000,
  });
  if (r.status !== 0) {
    return { installed: false, error: 'kontrol not found — install K framework (https://github.com/runtimeverification/k)' };
  }
  const version = (r.stdout || '').trim().split('\n')[0] || 'unknown';
  return { installed: true, version };
}

function findTestFile(testPath) {
  const fs = require('fs');
  const resolved = path.resolve(testPath);

  if (fs.existsSync(resolved)) return resolved;

  const halmosDir = path.join(__dirname, '..', 'halmos');
  const inHalmos = path.join(halmosDir, testPath);
  if (fs.existsSync(inHalmos)) return inHalmos;

  return null;
}

function parseKontrolOutput(stdout, stderr) {
  const results = [];
  const combined = (stdout || '') + '\n' + (stderr || '');

  const passPattern = /^\s*(\S+.*?)\s*:\s*PASS\s*$/gm;
  const failPattern = /^\s*(\S+.*?)\s*:\s*FAIL\s*$/gm;

  let m;
  while ((m = passPattern.exec(combined)) !== null) {
    results.push({ test: m[1].trim(), status: 'passed' });
  }
  while ((m = failPattern.exec(combined)) !== null) {
    const name = m[1].trim();
    if (!results.some((r) => r.test === name)) {
      results.push({ test: name, status: 'failed' });
    }
  }

  return results;
}

function runKontrol(testContract, options = {}) {
  const { testGlob } = options;

  const kontrol = checkKontrol();
  if (!kontrol.installed) {
    return {
      ok: false,
      error: kontrol.error,
      details: 'Kontrol requires the K framework. See https://github.com/runtimeverification/k for installation instructions.',
    };
  }

  const cwd = process.cwd();
  const args = ['prove'];

  if (testGlob && testGlob !== '*') {
    args.push('--match-test', testGlob);
  }

  args.push('--verbose');

  const result = spawnSync('kontrol', args, {
    cwd,
    encoding: 'utf-8',
    timeout: 300000,
  });

  const tests = parseKontrolOutput(result.stdout, result.stderr);

  const summary = {
    total: tests.length,
    passed: tests.filter((t) => t.status === 'passed').length,
    failed: tests.filter((t) => t.status === 'failed').length,
  };

  return {
    ok: result.status === 0 || summary.passed > 0,
    kontrolVersion: kontrol.version,
    exitCode: result.status,
    tests,
    summary,
    stdout: result.stdout,
    stderr: result.stderr,
    error: result.error ? result.error.message : null,
  };
}

module.exports = { checkKontrol, runKontrol, findTestFile };
