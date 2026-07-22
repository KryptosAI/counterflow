const { spawnSync } = require('child_process');
const path = require('path');

const EXTRACT_SCRIPT = path.join(__dirname, '..', 'slither', 'extract_binding.py');

function runSlither(contractPath, args, python) {
  const cmd = python || 'python3';
  const r = spawnSync(cmd, [EXTRACT_SCRIPT, contractPath, ...args], { encoding: 'utf-8', timeout: 30000 });
  if (r.status !== 0) return { ok: false, error: `slither analysis failed: ${(r.stderr || r.stdout || '').trim()}` };
  try { return { ok: true, data: JSON.parse(r.stdout) }; }
  catch { return { ok: false, error: `could not parse slither output: ${r.stdout?.slice(0, 200)}` }; }
}

function analyzeCompleteness(slitherReport, binding) {
  const stateVars = slitherReport.state_variables || [];
  const trackedKinds = ['balance', 'share', 'allowance', 'total', 'lp_balance', 'reserve', 'collateral', 'debt', 'stake', 'reward', 'lock'];

  const relevant = stateVars.filter(v => trackedKinds.includes(v.classification || ''));
  const bindingEffects = new Set();
  (binding.functions || []).forEach(fn => (fn.effects || []).forEach(e => bindingEffects.add(e)));

  const covered = [];
  const uncovered = [];
  const warnings = [];

  for (const v of relevant) {
    const varName = v.name;
    const fnNames = (v.written_by || []).map(f => typeof f === 'string' ? f : f.name);
    const hasEffect = fnNames.some(fnName => {
      const bfn = (binding.functions || []).find(bf => bf.name === fnName);
      return bfn && (bfn.effects || []).length > 0;
    });
    if (hasEffect || fnNames.length === 0) {
      covered.push(varName);
    } else {
      uncovered.push(varName);
      warnings.push(`${v.name} (${v.classification || 'unknown'}): written by ${fnNames.join(',')} but no matching effect in binding`);
    }
  }

  const total = relevant.length;
  const coveredCount = covered.length;
  const score = total > 0 ? Math.round((coveredCount / total) * 100) : 100;
  const label = score >= 90 ? 'PASS' : score >= 60 ? 'WARN' : 'FAIL';

  return {
    score, scoreLabel: label, covered: coveredCount, totalTracked: total,
    coveredVars: covered, uncoveredVars: uncovered, warnings,
    allStateVars: stateVars.map(v => ({ name: v.name, classification: v.classification }))
  };
}

function checkCompleteness(contractPath, binding, python) {
  const slitherRes = runSlither(contractPath, ['--completeness', '/dev/null'], python);
  if (!slitherRes.ok) return slitherRes;
  return { ok: true, result: analyzeCompleteness(slitherRes.data, binding || {}) };
}

module.exports = { checkCompleteness, analyzeCompleteness, runSlither };
