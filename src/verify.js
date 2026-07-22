const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { translate } = require('./translate');
const { validateBinding } = require('./validate');
const { logRun } = require('./audit');

const SOLVER = path.join(__dirname, '..', 'solver', 'check.py');

function pickPython() {
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

function runSolver(binding) {
  const python = pickPython();
  if (!python) {
    return { ok: false, error: 'No Python with z3 available. pip install z3-solver.' };
  }
  const r = spawnSync(python, [SOLVER], {
    input: JSON.stringify(binding),
    encoding: 'utf-8',
    cwd: path.dirname(SOLVER),
  });
  if (r.status !== 0) {
    return { ok: false, error: r.stderr || `solver exited ${r.status}` };
  }
  try {
    return { ok: true, output: JSON.parse(r.stdout) };
  } catch {
    return { ok: false, error: `unparseable solver output: ${r.stdout}` };
  }
}

/**
 * Full pipeline: Solidity + English -> LLM binding -> deterministic validation
 * -> sound Z3 verdict -> tamper-evident audit entry.
 *
 * `binding` may be supplied directly (bindingSource='provided') to run fully
 * offline without an LLM — useful for CI and reproducible benchmarks.
 */
async function verify({ contractPath, soliditySource, invariantsText, binding: providedBinding }) {
  const start = Date.now();
  const source = soliditySource != null
    ? soliditySource
    : fs.readFileSync(contractPath, 'utf-8');
  const contractSha256 = crypto.createHash('sha256').update(source).digest('hex');

  let binding = providedBinding || null;
  let bindingSource = providedBinding ? 'provided' : 'llm';
  let llmUsage = null;
  let translationError = null;

  if (!binding) {
    const t = await translate(source, invariantsText || '');
    binding = t.binding;
    llmUsage = t.usage || null;
    translationError = t.error || null;
  }

  if (!binding) {
    return {
      verdict: 'error',
      stage: 'translate',
      error: translationError || 'no binding produced',
    };
  }

  const validation = validateBinding(binding);
  if (!validation.valid) {
    return {
      verdict: 'error',
      stage: 'validate',
      error: 'binding failed validation',
      details: validation.errors,
      binding,
    };
  }

  const solver = runSolver(binding);
  if (!solver.ok) {
    return { verdict: 'error', stage: 'solve', error: solver.error, binding };
  }

  const durationMs = Date.now() - start;
  const entryId = logRun({
    contractPath: contractPath || '<inline>',
    contractSha256,
    invariantsText: invariantsText || '',
    binding,
    bindingSource,
    verdict: solver.output.verdict,
    solverOutput: solver.output,
    llmUsage,
    durationMs,
  });

  return {
    verdict: solver.output.verdict,
    stage: 'complete',
    binding,
    bindingSource,
    solver: solver.output,
    llmUsage,
    durationMs,
    auditEntryId: entryId,
    contractSha256,
  };
}

module.exports = { verify, runSolver, pickPython };
