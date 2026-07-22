const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const HALMOS_DIR = path.join(__dirname, '..', 'halmos');

function deriveHalmosFromPython(pythonPath) {
  if (!pythonPath) return null;
  const dir = path.dirname(pythonPath);
  const candidate = path.join(dir, 'halmos');
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

function pickHalmos() {
  const candidates = [
    deriveHalmosFromPython(process.env.COUNTERFLOW_PYTHON),
    path.join(__dirname, '..', '.venv', 'bin', 'halmos'),
    'halmos',
  ].filter(Boolean);

  for (const p of candidates) {
    const r = spawnSync(p, ['--version'], { encoding: 'utf-8', timeout: 10000 });
    if (r.status === 0) return p;
  }

  return null;
}

function pickPythonWithHalmos() {
  const candidates = [
    process.env.COUNTERFLOW_PYTHON,
    path.join(__dirname, '..', '.venv', 'bin', 'python'),
    'python3',
  ].filter(Boolean);
  for (const p of candidates) {
    const r = spawnSync(p, ['-c', 'import halmos'], { encoding: 'utf-8', timeout: 10000 });
    if (r.status === 0) return p;
  }
  return null;
}

function pickPythonInner() {
  const candidates = [
    process.env.COUNTERFLOW_PYTHON,
    path.join(__dirname, '..', '.venv', 'bin', 'python'),
    'python3',
  ].filter(Boolean);
  for (const p of candidates) {
    const r = spawnSync(p, ['-c', 'import z3'], { encoding: 'utf-8' });
    if (r.status === 0) return p;
  }
  return null;
}

function formatHalmosError() {
  const venvPath = path.join(__dirname, '..', '.venv', 'bin', 'halmos');
  const venvExists = fs.existsSync(venvPath);
  const lines = [
    'halmos not found. Install halmos:',
    '',
  ];
  if (venvExists) {
    lines.push(`  halmos found at ${venvPath} but it failed to run.`);
    lines.push(`  Check: ${venvPath} --version`);
  } else {
    lines.push('  pip install halmos');
    lines.push('  or');
    lines.push(`  source .venv/bin/activate && pip install halmos`);
  }
  return lines.join('\n');
}

/**
 * Run Halmos symbolic tests for a specific test contract (or all if '*').
 * Returns { ok, results: [{ name, passed, counterexample }] }.
 */
function runHalmos(testGlob) {
  const halmosBin = pickHalmos();
  if (halmosBin) {
    const build = spawnSync('forge', ['build'], { cwd: HALMOS_DIR, encoding: 'utf-8' });
    if (build.status !== 0) {
      return { ok: false, error: `forge build failed:\n${build.stderr}` };
    }

    const res = spawnSync(halmosBin, ['--root', HALMOS_DIR, '--contract', testGlob], {
      cwd: HALMOS_DIR,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const combined = (res.stdout || '') + '\n' + (res.stderr || '');
    const results = parseHalmosOutput(combined);

    return { ok: true, results };
  }

  const python = pickPythonWithHalmos();
  if (python) {
    const build = spawnSync('forge', ['build'], { cwd: HALMOS_DIR, encoding: 'utf-8' });
    if (build.status !== 0) {
      return { ok: false, error: `forge build failed:\n${build.stderr}` };
    }

    const res = spawnSync(python, ['-m', 'halmos', '--root', HALMOS_DIR, '--contract', testGlob], {
      cwd: HALMOS_DIR,
      encoding: 'utf-8',
      maxBuffer: 50 * 1024 * 1024,
    });

    const combined = (res.stdout || '') + '\n' + (res.stderr || '');
    const results = parseHalmosOutput(combined);

    return { ok: true, results };
  }

  return { ok: false, error: formatHalmosError() };
}

function parseHalmosOutput(text) {
  const results = [];

  const clean = text.replace(/\x1b\[[0-9;]*m/g, '');
  const lines = clean.split('\n');
  let currentFail = null;

  for (const line of lines) {
    const passMatch = line.match(/\[PASS\]\s+(\S+)/);
    const failMatch = line.match(/\[FAIL\]\s+(\S+)/);

    if (passMatch) {
      results.push({ name: passMatch[1], passed: true, counterexample: null });
      currentFail = null;
    } else if (failMatch) {
      currentFail = { name: failMatch[1], passed: false, counterexample: {} };
      results.push(currentFail);
    } else if (line.includes('Counterexample')) {
    } else if (currentFail && line.trim()) {
      const stripped = line.trim();
      const eq = stripped.indexOf(' = ');
      if (eq > 0) {
        const key = stripped.substring(0, eq).trim();
        const val = stripped.substring(eq + 3).trim();
        currentFail.counterexample[key] = val;
      }
    }
  }

  return results;
}

module.exports = { runHalmos };
