#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { verify, pickPython } = require('./verify');
const { render } = require('./report');
const { translate } = require('./translate');
const { validateBinding } = require('./validate');
const { verifyChain, LOG_PATH } = require('./audit');
const { runHalmos } = require('./halmos-runner');
const { diff: diffBindings } = require('./diff-engine');
const { runFuzzThenSymbolic } = require('./forge-symb');

const C = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function bytecodeReport(results) {
  const lines = [];
  for (const r of results) {
    const mark = r.passed ? `${C.green}✓ PASS${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
    lines.push(`  ${mark}  ${r.name}`);
    if (r.counterexample && Object.keys(r.counterexample).length > (r.counterexample.raw ? 1 : 0)) {
      lines.push(`    ${C.dim}cex:${C.reset} ${JSON.stringify(r.counterexample)}`);
    }
  }
  return lines.join('\n');
}

const USAGE = `Counterflow — Prove the contract, or reveal the exploit.

USAGE
  counterflow verify        <Contract.sol> <invariants.txt> [--binding binding.json] [--json]
  counterflow extract       <Contract.sol> <invariants.txt> [-o binding.json]
  counterflow check         <binding.json> [--json]
  counterflow bytecode      <TestContract> [--json]
  counterflow bench         [--json]
  counterflow audit
  counterflow audit-binding <Contract.sol> [--binding binding.json] [--json]
  counterflow gen-echidna   <binding.json> [--contract-name Name] [--output-dir path]
  counterflow gen-foundry   <binding.json> [--contract-name Name] [--output-dir path]
  counterflow fuzz-symb     <ContractName> [--test TestGlob]
  counterflow export-cvl    <binding.json> [-o output.spec]
  counterflow kontrol       <TestContract> [--test TestGlob]
  counterflow doctor
  counterflow leaderboard   [--json] [--markdown]
  counterflow badge         [label] [-o badge.svg]
  counterflow serve         [--port 3000]
  counterflow completeness  <Contract.sol> [--binding binding.json] [--json]
  counterflow mutate        <binding.json> [--json] [--max 50]

COMMANDS
  verify         Full pipeline: LLM translation -> validation -> sound Z3 verdict.
  extract        LLM translation only.
  check          Deterministic verification of a reviewed binding (no LLM).
  bytecode       Halmos symbolic execution against EVM bytecode.
                 Add --expect to gate on halmos/expectations.json (safe must PASS,
                 known exploits must FAIL with a counterexample). Exit 0 iff all match.
  bench          Run all benchmark + defihack cases.
  audit          Verify the tamper-evident audit chain.
  audit-binding  Cross-validate binding against Slither AST extraction.
  gen-echidna    Generate an Echidna fuzzing test contract from a binding.
  gen-foundry    Generate Foundry invariant test files from a binding.
  fuzz-symb      Run Foundry fuzz, promote counterexamples to Halmos.
  export-cvl     Generate a Certora Verification Language (CVL) .spec file from a binding.
  kontrol        Run K-framework Kontrol proofs on a Halmos test contract.
  doctor         Check all dependencies (node, python, z3, halmos, forge, solc, git).
  leaderboard    Print verified contract leaderboard (text, json, or markdown).
  badge          Generate shields.io-style SVG badge from audit log.
  serve          Start HTTP dashboard server with badge endpoint.
  completeness   Cross-reference binding against Slither storage enumeration.
  mutate         Run mutation tests — drop guards/effects, check if caught.

WHAT A VERDICT MEANS
  PROVED    = the modeled transition preserves the invariant for ALL inputs
              (inductive proof over the reviewed abstraction — not a claim
              that the contract is "safe").
  VIOLATED  = Z3 found a concrete counterexample (a real trace in the model).
  UNKNOWN   = solver could not decide within limits.`;

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : process.argv[i + 1];
}

async function main() {
  const cmd = process.argv[2];
  const json = process.argv.includes('--json');

  if (cmd === '--version' || cmd === '-v') {
    const pkg = require('../package.json');
    console.log(pkg.version);
    process.exit(0);
  }
  if (cmd === '--help' || cmd === '-h') { console.log(USAGE); process.exit(0); }

  if (cmd === 'verify') {
    const contractPath = process.argv[3];
    const invPath = process.argv[4];
    if (!contractPath || !invPath) { console.log(USAGE); process.exit(1); }
    const bindingPath = arg('--binding');
    const binding = bindingPath ? JSON.parse(fs.readFileSync(bindingPath, 'utf-8')) : undefined;
    const result = await verify({
      contractPath,
      invariantsText: fs.readFileSync(invPath, 'utf-8'),
      binding,
    });
    console.log(json ? JSON.stringify(result, null, 2) : render(result));
    process.exit(result.verdict === 'proved' ? 0 : result.verdict === 'violated' ? 3 : 2);
  }

  if (cmd === 'extract') {
    const contractPath = process.argv[3];
    const invPath = process.argv[4];
    if (!contractPath || !invPath) { console.log(USAGE); process.exit(1); }
    const out = arg('-o') || 'binding.json';
    const t = await translate(
      fs.readFileSync(contractPath, 'utf-8'),
      fs.readFileSync(invPath, 'utf-8'),
    );
    if (!t.binding) { console.error(`extract failed: ${t.error}`); process.exit(2); }
    const v = validateBinding(t.binding);
    fs.writeFileSync(out, JSON.stringify(t.binding, null, 2) + '\n');
    console.log(`binding written to ${out} (valid: ${v.valid}${v.valid ? '' : '; errors: ' + v.errors.join(', ')})`);
    console.log('REVIEW THIS FILE before running `counterflow check` — the binding is the trusted spec.');
    process.exit(v.valid ? 0 : 2);
  }

  if (cmd === 'check') {
    const bindingPath = process.argv[3];
    if (!bindingPath) { console.log(USAGE); process.exit(1); }
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
    const result = await verify({
      contractPath: bindingPath,
      soliditySource: JSON.stringify(binding),
      invariantsText: '(pre-reviewed binding)',
      binding,
    });
    console.log(json ? JSON.stringify(result, null, 2) : render(result));
    process.exit(result.verdict === 'proved' ? 0 : result.verdict === 'violated' ? 3 : 2);
  }

  if (cmd === 'bytecode') {
    if (process.argv.includes('--expect')) {
      const { spawnSync } = require('child_process');
      const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'bench', 'halmos-check.js')], { stdio: 'inherit' });
      process.exit(r.status == null ? 2 : r.status);
    }
    const testGlob = (process.argv[3] && !process.argv[3].startsWith('--')) ? process.argv[3] : '*';
    const res = runHalmos(testGlob);
    if (!res.ok) { console.error(`halmos error: ${res.error}`); process.exit(2); }
    console.log(json ? JSON.stringify(res.results, null, 2) : bytecodeReport(res.results));
    const failed = res.results.some(r => !r.passed);
    process.exit(failed ? 3 : 0);
  }

  if (cmd === 'bench') {
    const { spawnSync } = require('child_process');
    let exitCode = 0;

    const r1 = spawnSync('node', [path.join(__dirname, '..', 'bench', 'run.js')], { encoding: 'utf-8', stdio: 'inherit' });
    if ((r1.status || 0) !== 0) exitCode = 3;
    console.log('');

    const bc = runHalmos('*');
    console.log(`${C.bold}Halmos bytecode check${C.reset}`);
    console.log(bytecodeReport(bc.ok ? bc.results : []));
    if (bc.error) console.log(`  ${C.red}${bc.error}${C.reset}`);
    if (!bc.ok || bc.results.some(r => !r.passed)) exitCode = 3;
    console.log('');

    const dhPath = path.join(__dirname, '..', 'bench', 'defihack', 'runner.js');
    if (fs.existsSync(dhPath)) {
      const r2 = spawnSync('node', [dhPath], { encoding: 'utf-8', stdio: 'inherit' });
      if ((r2.status || 0) !== 0) exitCode = 3;
    } else {
      console.log(`${C.yellow}defihack runner not found at ${dhPath}${C.reset}`);
    }
    process.exit(exitCode);
  }

  if (cmd === 'audit') {
    const r = verifyChain();
    console.log(JSON.stringify({ ...r, log: LOG_PATH }, null, 2));
    process.exit(r.valid ? 0 : 2);
  }

  if (cmd === 'audit-binding') {
    const { spawnSync } = require('child_process');
    const contractPath = process.argv[3];
    if (!contractPath) { console.log(USAGE); process.exit(1); }
    const bindingPath = arg('--binding');

    const python = pickPython();
    const extractScript = path.join(__dirname, '..', 'slither', 'extract_binding.py');
    if (!fs.existsSync(extractScript)) {
      console.error(`${C.red}extract_binding.py not found${C.reset}`);
      process.exit(2);
    }

    const pyRes = spawnSync(python || 'python3', [extractScript, contractPath], { encoding: 'utf-8' });
    if (pyRes.status !== 0) {
      const stderr = (pyRes.stderr || '').trim();
      if (stderr.includes('slither not installed') || stderr.includes('No module named')) {
        console.log(`${C.red}slither not installed: pip install slither-analyzer${C.reset}`);
        process.exit(2);
      }
      console.error(`${C.red}slither error:${C.reset} ${stderr || 'unknown error'}`);
      process.exit(2);
    }

    let slitherBinding;
    try {
      slitherBinding = JSON.parse(pyRes.stdout);
    } catch {
      console.error(`${C.red}could not parse slither output${C.reset}`);
      process.exit(2);
    }

    if (!bindingPath) {
      console.log(json ? JSON.stringify(slitherBinding, null, 2) : JSON.stringify(slitherBinding, null, 2));
      process.exit(0);
    }

    const providedBinding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
    const diffResult = diffBindings(providedBinding, slitherBinding, contractPath);

    if (diffResult.differences.length === 0) {
      console.log(`${C.green}No differences — binding matches Slither extraction.${C.reset}`);
      if (json) console.log(JSON.stringify(diffResult, null, 2));
      process.exit(0);
    }

    console.log(`${C.yellow}Differences found:${C.reset}`);
    for (const d of diffResult.differences) {
      const fnLabel = d.function ? `[${d.function}] ` : '';
      console.log(`  ${C.red}✗${C.reset} ${fnLabel}${d.message}`);
    }
    console.log(json ? JSON.stringify(diffResult, null, 2) : '');
    process.exit(3);
  }

  if (cmd === 'gen-echidna') {
    const bindingPath = process.argv[3];
    if (!bindingPath) { console.log(USAGE); process.exit(1); }
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
    const contractName = arg('--contract-name') || binding.model || 'Contract';
    const outputDir = path.resolve(arg('--output-dir') || './echidna-output');
    fs.mkdirSync(outputDir, { recursive: true });

    const echidna = require('./echidna-gen');
    const sol = echidna.generateEchidnaTest(binding, contractName);
    const yaml = echidna.generateEchidnaConfig(binding);
    const solFile = path.join(outputDir, `Echidna${contractName}.sol`);
    const cfgFile = path.join(outputDir, 'echidna.yaml');
    fs.writeFileSync(solFile, sol);
    fs.writeFileSync(cfgFile, yaml);
    console.log(`${C.green}Echidna files generated:${C.reset}`);
    console.log(`  ${solFile}`);
    console.log(`  ${cfgFile}`);
    process.exit(0);
  }

  if (cmd === 'gen-foundry') {
    const bindingPath = process.argv[3];
    if (!bindingPath) { console.log(USAGE); process.exit(1); }
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
    const contractName = arg('--contract-name') || binding.model || 'Contract';
    const outputDir = path.resolve(arg('--output-dir') || './foundry-output');
    fs.mkdirSync(outputDir, { recursive: true });

    const foundry = require('./export-foundry');
    const out = foundry.renderSolidity(binding, contractName);
    const handlerFile = path.join(outputDir, `${contractName}Handler.sol`);
    const invFile = path.join(outputDir, `${contractName}Invariants.t.sol`);
    fs.writeFileSync(handlerFile, out.handler);
    fs.writeFileSync(invFile, out.invariants);
    console.log(`${C.green}Foundry files generated:${C.reset}`);
    console.log(`  ${handlerFile}`);
    console.log(`  ${invFile}`);
    process.exit(0);
  }

  if (cmd === 'fuzz-symb') {
    const { spawnSync } = require('child_process');
    const contractName = process.argv[3];
    if (!contractName) { console.log(USAGE); process.exit(1); }
    const testGlob = arg('--test') || '*';

    const hasForge = spawnSync('forge', ['--version'], { encoding: 'utf-8' }).status === 0;
    if (!hasForge) {
      console.log(`${C.red}forge not installed: install Foundry (https://book.getfoundry.sh)${C.reset}`);
      process.exit(2);
    }

    const results = runFuzzThenSymbolic(contractName, testGlob);
    if (!results.ok) {
      console.log(`${C.red}${results.error}${C.reset}`);
      process.exit(2);
    }

    console.log(`${C.bold}Fuzz + Symbolic Results — ${contractName}${C.reset}`);
    console.log(`\n${results.combinedSummary}`);
    console.log(`\n${C.bold}Forge Fuzz:${C.reset}`);
    console.log(`  exit code: ${results.fuzzResults.exitCode}`);
    console.log(`  failures: ${results.fuzzResults.failures}`);
    if (results.fuzzResults.failures > 0) {
      for (const cex of results.fuzzResults.counterexamples) {
        console.log(`    ${C.red}${cex.testName}${C.reset}: ${cex.reason}`);
      }
    }

    if (results.symbolicResults.length > 0) {
      console.log(`\n${C.bold}Halmos Symbolic:${C.reset}`);
      for (const sr of results.symbolicResults) {
        const allPassed = sr.halmos.ok && sr.halmos.results.every(r => r.passed);
        const mark = allPassed ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
        console.log(`  ${mark} ${sr.testName}`);
        if (!allPassed) {
          console.log(bytecodeReport(sr.halmos.results));
        }
      }
    }

    if (json) console.log(JSON.stringify(results, null, 2));
    process.exit(results.fuzzResults.failures > 0 ? 3 : 0);
  }

  if (cmd === 'export-cvl') {
    const bindingPath = process.argv[3];
    if (!bindingPath) { console.log(USAGE); process.exit(1); }
    const out = arg('-o') || bindingPath.replace(/\.json$/, '.spec');
    const cvl = require('./cvl-export');
    const result = cvl.exportCvl(path.resolve(bindingPath));
    if (!result.ok) {
      console.error(`${C.red}CVL export failed:${C.reset} ${result.error}`);
      process.exit(2);
    }
    fs.writeFileSync(out, result.cvl);
    console.log(`${C.green}CVL spec written to ${out}${C.reset}`);
    console.log(`${C.dim}Model: ${result.model}${C.reset}`);
    process.exit(0);
  }

  if (cmd === 'kontrol') {
    const { spawnSync } = require('child_process');
    const testContract = process.argv[3];
    if (!testContract) { console.log(USAGE); process.exit(1); }
    const testGlob = arg('--test') || '*';

    const { checkKontrol, runKontrol } = require('./kontrol-runner');
    const kc = checkKontrol();
    if (!kc.installed) {
      console.log(`${C.red}kontrol not installed.${C.reset}`);
      console.log(`${C.dim}Kontrol requires the K framework.${C.reset}`);
      console.log(`${C.dim}See https://github.com/runtimeverification/k for installation.${C.reset}`);
      process.exit(2);
    }

    console.log(`${C.bold}Kontrol — ${testContract}${C.reset}`);
    console.log(`${C.dim}Version: ${kc.version}${C.reset}`);

    const results = runKontrol(testContract, { testGlob });
    if (!results.ok && results.error) {
      console.log(`${C.red}Kontrol error:${C.reset} ${results.error}`);
      process.exit(2);
    }

    if (results.summary.total === 0) {
      console.log(`${C.yellow}No test results found. Ensure your .t.sol file is in the current directory.${C.reset}`);
    } else {
      console.log(`\n${C.bold}Results:${C.reset}`);
      console.log(`  Total:  ${results.summary.total}`);
      console.log(`  Passed: ${C.green}${results.summary.passed}${C.reset}`);
      console.log(`  Failed: ${results.summary.failed > 0 ? C.red : C.reset}${results.summary.failed}${C.reset}`);
      for (const t of results.tests) {
        const mark = t.status === 'passed' ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
        console.log(`  ${mark} ${t.test}`);
      }
    }

    if (json) console.log(JSON.stringify(results, null, 2));
    process.exit(results.summary.failed > 0 ? 3 : 0);
  }

  if (cmd === 'doctor') {
    const { spawnSync } = require('child_process');
    console.log(`${C.bold}Counterflow Doctor${C.reset}\n`);
    const venvDir = path.join(__dirname, '..', '.venv', 'bin');
    const venvHalmos = path.join(venvDir, 'halmos');
    const checks = [
      ['node', 'node -v', (o) => o.trim()],
      ['npm', 'npm -v', (o) => o.trim()],
      ['python3', `"${pickPython() || 'python3'}" --version`, (o) => o.trim()],
      ['z3-solver', `"${pickPython() || 'python3'}" -c "import z3; print(z3.get_version_string())"`, (o) => o.trim()],
      ['halmos (venv)', fs.existsSync(venvHalmos) ? `"${venvHalmos}" --version` : 'halmos --version', (o) => o.trim()],
      ['forge', 'forge --version', (o) => o.split('\n')[0]?.trim()],
      ['solc', 'solc --version', (o) => o.split('\n')[0]?.trim()],
      ['git', 'git --version', (o) => o.trim()],
      ['counterflow', 'node "' + path.join(__dirname, 'cli.js') + '" --version', (o) => 'v' + o.trim()],
    ];
    let ok = true;
    for (const [name, cmdStr, parse] of checks) {
      const r = spawnSync('bash', ['-c', cmdStr], { encoding: 'utf-8', timeout: 5000 });
      if (r.status === 0 && r.stdout.trim()) {
        console.log(`  ${C.green}✓${C.reset} ${name} ${C.dim}${parse(r.stdout)}${C.reset}`);
      } else {
        console.log(`  ${C.red}✗${C.reset} ${name} ${C.dim}(not found)${C.reset}`);
        ok = false;
      }
    }
    const venvPy = path.join(venvDir, 'python');
    if (require('fs').existsSync(venvPy)) {
      console.log(`  ${C.green}✓${C.reset} venv ${C.dim}${venvPy}${C.reset}`);
    }
    if (!ok) console.log(`\n${C.yellow}Some dependencies missing. See install instructions in README.md.${C.reset}`);
    process.exit(ok ? 0 : 2);
  }

  if (cmd === 'leaderboard') {
    const { leaderboardData, renderText, renderMarkdown } = require('./leaderboard');
    const data = leaderboardData();
    if (process.argv.includes('--markdown')) {
      console.log(renderMarkdown(data));
    } else if (json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(renderText(data));
    }
    process.exit(0);
  }

  if (cmd === 'badge') {
    const { badgeSvg } = require('./badge');
    const label = process.argv[3] || 'counterflow';
    const out = arg('-o') || 'badge.svg';
    const outDir = path.dirname(path.resolve(out));
    if (!fs.existsSync(outDir)) {
      console.error(`${C.red}output directory does not exist: ${outDir}${C.reset}`);
      process.exit(2);
    }
    const svg = badgeSvg(label);
    try {
      fs.writeFileSync(out, svg);
    } catch (e) {
      console.error(`${C.red}could not write badge to ${out}: ${e.message}${C.reset}`);
      process.exit(2);
    }
    console.log(`${C.green}Badge written to ${out}${C.reset}`);
    process.exit(0);
  }

  if (cmd === 'serve') {
    const http = require('http');
    const { dashboardHtml } = require('./dashboard');
    const { badgeSvg } = require('./badge');
    const port = parseInt(arg('--port') || '3000', 10);

    const server = http.createServer((req, res) => {
      if (req.url === '/badge.svg') {
        res.writeHead(200, { 'Content-Type': 'image/svg+xml' });
        res.end(badgeSvg('counterflow'));
      } else if (req.url === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(dashboardHtml());
      }
    });

    const shutdown = (signal) => {
      console.log(`\n${C.yellow}Received ${signal}, shutting down...${C.reset}`);
      server.close(() => {
        console.log(`${C.green}Server stopped.${C.reset}`);
        process.exit(0);
      });
      setTimeout(() => {
        console.log(`${C.red}Forced shutdown.${C.reset}`);
        process.exit(1);
      }, 5000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    server.on('error', (e) => {
      const msg = e.code === 'EADDRINUSE'
        ? `port ${port} already in use (try --port 0 for an OS-assigned port)`
        : e.message;
      console.error(`${C.red}serve error:${C.reset} ${msg}`);
      process.exit(2);
    });

    server.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`${C.green}Dashboard:${C.reset} http://localhost:${actualPort}`);
      console.log(`${C.green}Badge:${C.reset}    http://localhost:${actualPort}/badge.svg`);
      console.log(`\n${C.dim}Press Ctrl+C to stop${C.reset}`);
    });
    return; // don't exit — server keeps running
  }

  if (cmd === 'completeness') {
    const { spawnSync } = require('child_process');
    const contractPath = process.argv[3];
    if (!contractPath) { console.log(USAGE); process.exit(1); }
    const { checkCompleteness } = require('./completeness');
    const bindingPath = arg('--binding');
    let binding = {};
    if (bindingPath) {
      try { binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8')); }
      catch { console.error(`${C.red}could not read binding${C.reset}`); process.exit(2); }
    }
    const slitherBin = path.join(__dirname, '..', '.venv', 'bin', 'slither');
    const hasSlither = fs.existsSync(slitherBin);
    if (!hasSlither) {
      const pathSlither = spawnSync('slither', ['--version'], { encoding: 'utf-8' }).status === 0;
      if (!pathSlither) {
        console.error(`${C.red}slither not installed. Install: pip install slither-analyzer${C.reset}`);
        process.exit(2);
      }
    }
    const python = pickPython();
    if (!python) { console.error(`${C.red}No Python with z3 available${C.reset}`); process.exit(2); }
    const result = checkCompleteness(path.resolve(contractPath), binding, python);
    if (!result.ok) { console.error(`${C.red}${result.error}${C.reset}`); process.exit(2); }
    if (json) {
      console.log(JSON.stringify(result.result, null, 2));
    } else {
      const a = result.result;
      const mark = a.scoreLabel === 'PASS' ? `${C.green}✓ PASS${C.reset}` : a.scoreLabel === 'WARN' ? `${C.yellow}⚠ WARN${C.reset}` : `${C.red}✗ FAIL${C.reset}`;
      console.log(`\n${C.bold}Binding Completeness Report${C.reset} — ${contractPath}`);
      console.log(`  ${mark}  Completeness score: ${a.score}% (${a.covered}/${a.totalTracked} tracked variables covered)\n`);
      if (a.warnings.length > 0) {
        for (const w of a.warnings) console.log(`  ${C.yellow}⚠${C.reset} ${w}`);
      }
    }
    process.exit(result.result.scoreLabel === 'FAIL' ? 3 : 0);
  }

  if (cmd === 'mutate') {
    const bindingPath = process.argv[3];
    if (!bindingPath) { console.log(USAGE); process.exit(1); }
    const binding = JSON.parse(fs.readFileSync(bindingPath, 'utf-8'));
    const { runMutations } = require('./mutate');
    const maxArg = arg('--max');
    const max = maxArg != null ? parseInt(maxArg, 10) || 0 : 50;
    const report = runMutations(binding, { max });
    if (json) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(`\n${C.bold}Mutation Test Report${C.reset}`);
      console.log(`  Base verdict: ${report.baseVerdict}`);
      console.log(`  Mutations: ${report.totalMutations} (${report.caught} caught, ${report.missed} missed)`);
      console.log(`  Mutation score: ${report.score}%\n`);
      for (const r of report.results.slice(0, 10)) {
        const mark = r.caught ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
        console.log(`  ${mark} [${r.function}] ${r.detail}`);
      }
      if (report.results.length > 10) console.log(`  ${C.dim}... and ${report.results.length - 10} more${C.reset}`);
    }
    process.exit(report.missed > 0 ? 3 : 0);
  }

  console.log(USAGE);
  process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(2); });
