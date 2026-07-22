const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawnSync } = require('child_process');
const { runSolver } = require('../src/verify');
const { validateBinding } = require('../src/validate');

const buggy = require('../examples/TokenPoolBuggy.binding.json');
const correct = require('../examples/TokenPool.binding.json');

function run() {
  let failures = 0;
  const t = (name, fn) => {
    try { fn(); console.log(`  ✓ ${name}`); }
    catch (e) { failures++; console.log(`  ✗ ${name}\n      ${e.message}`); }
  };

  console.log('validation');
  t('correct binding validates', () => {
    assert.strictEqual(validateBinding(correct).valid, true);
  });
  t('buggy binding validates (structurally)', () => {
    assert.strictEqual(validateBinding(buggy).valid, true);
  });
  t('rejects unknown effect', () => {
    const bad = JSON.parse(JSON.stringify(correct));
    bad.functions[0].effects.push('bal_teleport');
    assert.strictEqual(validateBinding(bad).valid, false);
  });

  console.log('soundness / Z3 core');
  t('correct contract: all invariants PROVED', () => {
    const r = runSolver(correct);
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.output.verdict, 'proved');
  });
  t('buggy contract: nonneg_balance VIOLATED with counterexample', () => {
    const r = runSolver(buggy);
    assert.ok(r.ok, r.error);
    assert.strictEqual(r.output.verdict, 'violated');
    const withdraw = r.output.functions.find((f) => f.function === 'withdraw');
    const nb = withdraw.results.find((x) => x.invariant === 'nonneg_balance');
    assert.strictEqual(nb.status, 'violated');
    assert.ok(nb.counterexample, 'expected a counterexample');
    assert.ok(Number(nb.counterexample.balance_actor_post) < 0, 'post balance should be negative');
  });

  console.log('reentrancy vocabulary');
  t('reentrancy binding validates', () => {
    const reentrancyBinding = {
      model: "erc20_pool",
      functions: [
        {
          name: "withdraw",
          guards: ["amt_gt_0", "bal_ge_amt", "not_locked"],
          effects: ["reentrancy_lock_acquire", "bal_sub_amt", "total_sub_amt", "external_call", "reentrancy_lock_release"]
        }
      ],
      invariants: ["nonneg_balance", "nonneg_total", "reentrancy_safe"]
    };
    const v = validateBinding(reentrancyBinding);
    assert.strictEqual(v.valid, true, v.errors ? v.errors.join(', ') : '');
  });
  t('reentrancy binding runs through solver', () => {
    const reentrancyBinding = {
      model: "erc20_pool",
      functions: [
        {
          name: "withdraw",
          guards: ["amt_gt_0", "bal_ge_amt", "not_locked"],
          effects: ["reentrancy_lock_acquire", "bal_sub_amt", "total_sub_amt", "external_call", "reentrancy_lock_release"]
        }
      ],
      invariants: ["nonneg_balance", "nonneg_total", "reentrancy_safe"]
    };
    const r = runSolver(reentrancyBinding);
    assert.ok(r.ok, r.error);
    assert.ok(['proved', 'violated'].includes(r.output.verdict),
      `unexpected verdict: ${r.output.verdict}`);
  });

  console.log('diff engine');
  t('diff detects changes between bindings', () => {
    const { diff, generateSuggestedBinding } = require('../src/diff-engine');
    const a = {
      model: "erc20_pool",
      functions: [{ name: "withdraw", guards: ["amt_gt_0"], effects: ["bal_sub_amt"] }],
      invariants: ["nonneg_balance"]
    };
    const b = {
      model: "erc20_pool",
      functions: [{ name: "withdraw", guards: ["amt_gt_0", "bal_ge_amt"], effects: ["bal_sub_amt", "total_sub_amt"] }],
      invariants: ["nonneg_balance", "nonneg_total"]
    };
    const d = diff(a, b);
    assert.ok(Array.isArray(d.differences), 'diff should have a differences array');
    assert.ok(typeof d.summary === 'object', 'diff should have a summary object');
    assert.ok(d.summary.total_functions > 0, 'summary should count functions');
    const s = generateSuggestedBinding(a, b);
    assert.ok(Array.isArray(s.functions), 'should produce a binding with functions');
    assert.ok(s.functions.length > 0, 'merged binding should have functions');
  });

  console.log('echidna gen');
  t('generateEchidnaTest produces valid output', () => {
    const { generateEchidnaTest } = require('../src/echidna-gen');
    const out = generateEchidnaTest(correct);
    assert.ok(typeof out === 'string', 'output should be a string');
    assert.ok(out.includes('echidna_'), 'output should contain echidna_ properties');
    assert.ok(out.includes('contract Echidna'), 'output should contain contract Echidna');
  });

  console.log('foundry export');
  t('renderSolidity produces handler + invariants', () => {
    const { renderSolidity } = require('../src/export-foundry');
    const out = renderSolidity(correct);
    assert.ok(out.handler, 'output should have .handler key');
    assert.ok(out.invariants, 'output should have .invariants key');
    assert.ok(
      out.handler.includes('function invariant_') || out.invariants.includes('function invariant_'),
      'output should contain function invariant_'
    );
  });

  console.log('CVL export');
  t('generateCvl produces valid CVL with ghost variables', () => {
    const { generateCvl } = require('../src/cvl-export');
    const cvl = generateCvl(correct);
    assert.ok(typeof cvl === 'string', 'output should be a string');
    assert.ok(cvl.length > 0, 'output should not be empty');
    assert.ok(cvl.includes('ghost'), 'output should contain ghost declarations');
    assert.ok(cvl.includes('rule deposit'), 'output should contain rule for deposit');
    assert.ok(cvl.includes('rule withdraw'), 'output should contain rule for withdraw');
    assert.ok(cvl.includes('require amt > 0'), 'output should contain require amt > 0');
    assert.ok(cvl.includes('invariant nonneg_balance'), 'output should contain invariant nonneg_balance');
    assert.ok(cvl.includes('invariant nonneg_total'), 'output should contain invariant nonneg_total');
    assert.ok(cvl.includes('invariant solvency'), 'output should contain invariant solvency');
    assert.ok(cvl.includes('preserve'), 'output should contain preserve block');
  });
  t('exportCvl rejects invalid binding', () => {
    const { exportCvl } = require('../src/cvl-export');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(__dirname, '..', 'tmp_invalid.json');
    fs.writeFileSync(tmp, '{ "not": "a binding" }');
    const result = exportCvl(tmp);
    fs.unlinkSync(tmp);
    assert.strictEqual(result.ok, false);
    assert.ok(result.error, 'should return an error');
  });
  t('exportCvl succeeds with valid binding', () => {
    const { exportCvl } = require('../src/cvl-export');
    const fs = require('fs');
    const path = require('path');
    const tmp = path.join(__dirname, '..', 'tmp_valid.json');
    fs.writeFileSync(tmp, JSON.stringify(correct));
    const result = exportCvl(tmp);
    fs.unlinkSync(tmp);
    assert.strictEqual(result.ok, true);
    assert.ok(result.cvl, 'should return CVL output');
    assert.strictEqual(result.model, 'erc20_pool');
  });

  console.log('audit chain');
  t('log + verify round-trip', () => {
    const tmp = path.join(os.tmpdir(), `cf-audit-${Date.now()}.jsonl`);
    process.env.COUNTERFLOW_AUDIT = tmp;
    delete require.cache[require.resolve('../src/audit')];
    const audit = require('../src/audit');
    const baseArgs = {
      contractPath: '<test>', contractSha256: '0'.repeat(64), invariantsText: '',
      binding: correct, bindingSource: 'provided',
      solverOutput: { verdict: 'proved' }, llmUsage: null, durationMs: 1,
    };
    audit.logRun({ ...baseArgs, verdict: 'proved' });
    audit.logRun({ ...baseArgs, verdict: 'violated', durationMs: 2 });
    const res = audit.verifyChain();
    assert.strictEqual(res.valid, true);
    assert.strictEqual(res.entries, 2);
    fs.unlinkSync(tmp);
    delete process.env.COUNTERFLOW_AUDIT;
  });
  t('tamper detection', () => {
    const tmp = path.join(os.tmpdir(), `cf-audit-tamper-${Date.now()}.jsonl`);
    process.env.COUNTERFLOW_AUDIT = tmp;
    delete require.cache[require.resolve('../src/audit')];
    let audit = require('../src/audit');
    audit.logRun({
      contractPath: '<test>', contractSha256: '0'.repeat(64), invariantsText: '',
      binding: correct, bindingSource: 'provided', verdict: 'proved',
      solverOutput: { verdict: 'proved' }, llmUsage: null, durationMs: 1,
    });
    const entry = JSON.parse(fs.readFileSync(tmp, 'utf-8').trim().split('\n')[0]);
    entry.verdict = entry.verdict === 'proved' ? 'violated' : 'proved';
    fs.writeFileSync(tmp, JSON.stringify(entry) + '\n');
    delete require.cache[require.resolve('../src/audit')];
    audit = require('../src/audit');
    const res = audit.verifyChain();
    assert.strictEqual(res.valid, false);
    assert.strictEqual(res.broken_at, 0);
    fs.unlinkSync(tmp);
    delete process.env.COUNTERFLOW_AUDIT;
  });

  console.log('vocabulary gate');
  t('counts match documented totals', () => {
    const { GUARDS, EFFECTS, INVARIANTS } = require('../src/translate');
    assert.strictEqual(GUARDS.length, 27);
    assert.strictEqual(EFFECTS.length, 43);
    assert.strictEqual(INVARIANTS.length, 33);
  });
  t('JS and Python vocabularies are identical', () => {
    const { GUARDS, EFFECTS, INVARIANTS } = require('../src/translate');
    const { pickPython } = require('../src/verify');
    const python = pickPython();
    assert.ok(python, 'no python with z3 available');
    const r = spawnSync(python, ['-c', 'import json; from models import GUARDS, EFFECTS, INVARIANTS; print(json.dumps([sorted(GUARDS), sorted(EFFECTS), sorted(INVARIANTS)]))'], { cwd: path.join(__dirname, '..', 'solver'), encoding: 'utf-8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const [pyGuards, pyEffects, pyInvariants] = JSON.parse(r.stdout);
    assert.deepStrictEqual([...GUARDS].sort(), pyGuards);
    assert.deepStrictEqual([...EFFECTS].sort(), pyEffects);
    assert.deepStrictEqual([...INVARIANTS].sort(), pyInvariants);
  });

  console.log('vacuity check');
  t('example bindings are not vacuous', () => {
    for (const b of [correct, buggy]) {
      const r = runSolver(b);
      assert.ok(r.ok, r.error);
      for (const f of r.output.functions) {
        assert.strictEqual(typeof f.vacuous, 'boolean', `vacuous should be boolean for ${f.function}`);
        assert.strictEqual(f.vacuous, false, `expected non-vacuous for ${f.function}`);
      }
    }
  });

  console.log('cli');
  t('--version prints package version', () => {
    const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'src', 'cli.js'), '--version'], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout.trim(), require('../package.json').version);
  });

  console.log('module smoke');
  t('mutate returns a report', () => {
    const { runMutations } = require('../src/mutate');
    const report = runMutations(correct, { max: 5 });
    assert.ok(report && typeof report === 'object', 'report should be an object');
    assert.ok(typeof report.totalMutations === 'number' && report.totalMutations > 0,
      'totalMutations should be a positive number');
    assert.ok('score' in report, 'report should have a score property');
  });
  t('leaderboard data loads', () => {
    const { leaderboardData } = require('../src/leaderboard');
    const data = leaderboardData();
    assert.ok(Array.isArray(data), 'leaderboardData should return an array');
  });
  t('badge svg renders', () => {
    const { badgeSvg } = require('../src/badge');
    const svg = badgeSvg('counterflow');
    assert.strictEqual(typeof svg, 'string');
    assert.ok(svg.includes('<svg'), 'badge should contain <svg');
  });

  console.log('completeness');
  t('analyzeCompleteness scores coverage', () => {
    const { analyzeCompleteness } = require('../src/completeness');
    const report = {
      state_variables: [
        { name: 'balances', classification: 'balance', written_by: ['deposit', 'withdraw'] },
        { name: 'totalAssets', classification: 'total', written_by: [{ name: 'deposit' }] },
        { name: 'owner', classification: 'other', written_by: [] },
      ],
    };
    const binding = {
      functions: [
        { name: 'deposit', effects: ['bal_add_amt'] },
        { name: 'withdraw', effects: ['bal_sub_amt'] },
      ],
    };
    const r = analyzeCompleteness(report, binding);
    assert.strictEqual(r.totalTracked, 2);
    assert.strictEqual(r.covered, 2);
    assert.strictEqual(r.score, 100);
    assert.strictEqual(r.scoreLabel, 'PASS');
  });
  t('analyzeCompleteness flags uncovered variables', () => {
    const { analyzeCompleteness } = require('../src/completeness');
    const report = {
      state_variables: [
        { name: 'balances', classification: 'balance', written_by: ['withdraw'] },
        { name: 'debt', classification: 'debt', written_by: ['borrow'] },
      ],
    };
    const binding = { functions: [{ name: 'withdraw', effects: ['bal_sub_amt'] }] };
    const r = analyzeCompleteness(report, binding);
    assert.strictEqual(r.score, 50);
    assert.strictEqual(r.scoreLabel, 'FAIL');
    assert.deepStrictEqual(r.uncoveredVars, ['debt']);
    assert.strictEqual(r.warnings.length, 1);
  });
  t('checkCompleteness fails gracefully on bad input', () => {
    const { checkCompleteness } = require('../src/completeness');
    const r = checkCompleteness('/nonexistent/Contract.sol', {}, null);
    assert.strictEqual(r.ok, false);
    assert.ok(r.error, 'should return an error message');
  });

  console.log('serve');
  t('serve responds on /health and shuts down', () => {
    const cli = path.join(__dirname, '..', 'src', 'cli.js');
    const port = 41337;
    const script = [
      `node "${cli}" serve --port ${port} >/dev/null 2>&1 &`,
      'SRV=$!',
      'trap "kill $SRV 2>/dev/null" EXIT',
      'OUT=""',
      `for i in $(seq 1 40); do OUT=$(curl -s --max-time 1 http://localhost:${port}/health 2>/dev/null) && [ -n "$OUT" ] && break; sleep 0.25; done`,
      'kill $SRV 2>/dev/null',
      'wait $SRV 2>/dev/null',
      'trap - EXIT',
      'printf %s "$OUT"',
    ].join('\n');
    const r = spawnSync('bash', ['-c', script], { encoding: 'utf-8', timeout: 20000 });
    assert.ok(r.stdout.includes('"status":"ok"'),
      `expected /health {"status":"ok"}, got stdout="${r.stdout}" stderr="${r.stderr}"`);
  });

  console.log('');
  if (failures) { console.error(`${failures} test(s) failed`); process.exit(1); }
  console.log('all tests passed');
}

run();
