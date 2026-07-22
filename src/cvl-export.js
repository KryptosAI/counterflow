const { GUARDS, EFFECTS, INVARIANTS } = require('./translate');
const { validateBinding } = require('./validate');

const EFFECT_TO_GHOST_UPDATE = {
  bal_add_amt: 'ghost_sumBalances = ghost_sumBalances + amt;',
  bal_sub_amt: 'ghost_sumBalances = ghost_sumBalances - amt;',
  bal_add_amt_to: 'ghost_sumBalances = ghost_sumBalances + amt;',
  bal_sub_amt_src: 'ghost_sumBalances = ghost_sumBalances - amt;',
  set_bal_zero: 'ghost_sumBalances = ghost_sumBalances - balances[e.msg.sender];',
  total_add_amt: 'ghost_sumTotal = ghost_sumTotal + amt;',
  total_sub_amt: 'ghost_sumTotal = ghost_sumTotal - amt;',
  shares_add_amt: 'ghost_sumShares = ghost_sumShares + amt;',
  shares_sub_amt: 'ghost_sumShares = ghost_sumShares - amt;',
  total_shares_add_amt: 'ghost_sumTotalShares = ghost_sumTotalShares + amt;',
  total_shares_sub_amt: 'ghost_sumTotalShares = ghost_sumTotalShares - amt;',
  allowance_sub_amt: 'ghost_sumAllowances = ghost_sumAllowances - amt;',
};

const GHOST_DECLARATIONS = [
  'ghost mathint ghost_sumBalances { init_state assert ghost_sumBalances == 0; }',
  'ghost mathint ghost_sumTotal { init_state assert ghost_sumTotal == 0; }',
  'ghost mathint ghost_sumShares { init_state assert ghost_sumShares == 0; }',
  'ghost mathint ghost_sumTotalShares { init_state assert ghost_sumTotalShares == 0; }',
  'ghost mathint ghost_sumAllowances { init_state assert ghost_sumAllowances == 0; }',
  'ghost bool ghost_locked;',
];

const INVARIANT_CONDITIONS = {
  nonneg_balance: 'ghost_sumBalances >= 0',
  nonneg_shares: 'ghost_sumShares >= 0',
  nonneg_allowance: 'ghost_sumAllowances >= 0',
  nonneg_total: 'ghost_sumTotal >= 0',
  nonneg_total_shares: 'ghost_sumTotalShares >= 0',
  solvency: 'ghost_sumBalances == ghost_sumTotal',
  shares_integrity: 'ghost_sumShares == ghost_sumTotalShares',
  backing: 'ghost_sumTotal >= ghost_sumTotalShares',
  supply_cap: 'ghost_sumTotal <= to_mathint(CAP())',
  reentrancy_safe: 'ghost_locked == false',
  nonneg_reserves: 'true',
  nonneg_lp: 'true',
  constant_product: 'true',
  lp_integrity: 'true',
  backing_amm: 'true',
  nonneg_collateral: 'true',
  nonneg_debt: 'true',
  nonneg_total_collateral: 'true',
  nonneg_total_debt: 'true',
  collateral_integrity: 'true',
  debt_integrity: 'true',
  overcollateralized: 'true',
  lending_solvency: 'true',
  nonneg_staked: 'true',
  nonneg_rewards: 'true',
  stake_integrity: 'true',
  reward_integrity: 'true',
  staking_backing: 'true',
  cross_contract_safe: 'ghost_locked == false',
};

const GUARD_TO_REQUIRE = {
  amt_gt_0: 'amt > 0',
  bal_ge_amt: 'balances[e.msg.sender] >= amt',
  bal_gt_0: 'balances[e.msg.sender] > 0',
  total_ge_amt: 'totalAssets >= amt',
  sender_is_owner: 'e.msg.sender == owner',
  bal_src_ge_amt: 'balances[src] >= amt',
  allowance_ge_amt: 'allowances[src][e.msg.sender] >= amt',
  shares_ge_amt: 'shares[e.msg.sender] >= amt',
  total_shares_ge_amt: 'totalShares >= amt',
  not_locked: 'ghost_locked == false',
  balance_unchanged_before_call: 'true',
  dx_gt_0: 'dx > 0',
  dy_gt_0: 'dy > 0',
  reserveX_ge_dx: 'reserveX >= dx',
  reserveY_ge_dy: 'reserveY >= dy',
  lp_ge_amt: 'lp >= amt',
  collateral_ge_amt: 'collateral >= amt',
  debt_ge_amt: 'debt >= amt',
  healthy_position: 'true',
  staked_ge_amt: 'staked >= amt',
  rewards_ge_amt: 'rewards >= amt',
  cross_not_in_progress: 'true',
  cross_snapshot_match: 'true',
};

const INVARIANT_LABELS = {
  nonneg_balance: 'balances never negative',
  nonneg_shares: 'shares never negative',
  nonneg_allowance: 'allowances never negative',
  nonneg_total: 'total assets never negative',
  nonneg_total_shares: 'total shares never negative',
  solvency: 'sum of balances equals total assets',
  shares_integrity: 'sum of shares equals total shares',
  backing: 'enough assets to back all shares',
  supply_cap: 'total assets does not exceed cap',
  reentrancy_safe: 'no reentrancy possible',
  nonneg_reserves: 'reserves never negative',
  nonneg_lp: 'LP tokens never negative',
  constant_product: 'constant product invariant holds',
  lp_integrity: 'LP token integrity',
  backing_amm: 'AMM backing',
  nonneg_collateral: 'collateral never negative',
  nonneg_debt: 'debt never negative',
  nonneg_total_collateral: 'total collateral never negative',
  nonneg_total_debt: 'total debt never negative',
  collateral_integrity: 'collateral integrity',
  debt_integrity: 'debt integrity',
  overcollateralized: 'positions are overcollateralized',
  lending_solvency: 'lending pool is solvent',
  nonneg_staked: 'staked amount never negative',
  nonneg_rewards: 'rewards never negative',
  stake_integrity: 'stake integrity',
  reward_integrity: 'reward integrity',
  staking_backing: 'staking backing',
  cross_contract_safe: 'cross-contract call safety',
};

function usesEffect(binding, prefixes) {
  return (binding.functions || []).some((fn) =>
    (fn.effects || []).some((e) => prefixes.some((p) => e.startsWith(p)))
  );
}

function computeRelevantGhosts(binding) {
  const ghosts = [];

  if (usesEffect(binding, ['bal_', 'set_bal_zero'])) {
    ghosts.push('ghost mathint ghost_sumBalances { init_state assert ghost_sumBalances == 0; }');
  }
  if (usesEffect(binding, ['total_'])) {
    ghosts.push('ghost mathint ghost_sumTotal { init_state assert ghost_sumTotal == 0; }');
  }
  if (usesEffect(binding, ['shares_'])) {
    ghosts.push('ghost mathint ghost_sumShares { init_state assert ghost_sumShares == 0; }');
  }
  if (usesEffect(binding, ['total_shares_'])) {
    ghosts.push('ghost mathint ghost_sumTotalShares { init_state assert ghost_sumTotalShares == 0; }');
  }
  if (usesEffect(binding, ['allowance_'])) {
    ghosts.push('ghost mathint ghost_sumAllowances { init_state assert ghost_sumAllowances == 0; }');
  }

  const needsLocked =
    (binding.functions || []).some((fn) =>
      (fn.guards || []).includes('not_locked') ||
      (fn.effects || []).includes('reentrancy_lock_acquire')
    );
  if (needsLocked) {
    ghosts.push('ghost bool ghost_locked { init_state assert ghost_locked == false; }');
  }

  return ghosts;
}

function generateCvlRule(fn, idx) {
  const name = fn.name || `function_${idx}`;
  const guards = fn.guards || [];
  const effects = fn.effects || [];

  const lines = [];
  lines.push(`    /// @notice Counterflow rule for function: ${name}`);
  lines.push(`    rule ${name}(method f) {`);
  lines.push('        env e;');
  lines.push('        calldataarg args;');

  if (guards.length > 0) {
    lines.push('');
    lines.push('        // ---- pre-conditions (guards) ----');
    for (const g of guards) {
      const req = GUARD_TO_REQUIRE[g];
      if (req && req !== 'true') {
        lines.push(`        require ${req};`);
      }
    }
  }

  lines.push('');
  lines.push(`        f(e, args);`);

  if (effects.length > 0) {
    lines.push('');
    lines.push('        // ---- post-conditions (effects) ----');
    for (const e of effects) {
      const upd = EFFECT_TO_GHOST_UPDATE[e];
      if (upd) {
        lines.push(`        ${upd}`);
      }
    }
  }

  lines.push('    }');
  return lines.join('\n');
}

function generateCvlInvariant(inv) {
  const cond = INVARIANT_CONDITIONS[inv];
  if (!cond) return null;

  const label = INVARIANT_LABELS[inv] || inv;

  const lines = [];
  lines.push(`    /// @notice Invariant: ${label}`);
  lines.push(`    invariant ${inv}(method f)`);
  lines.push('        filtered { f -> true }');
  lines.push('    {');
  lines.push('        preserve {');
  if (cond === 'true') {
    lines.push(`            // ${inv}: placeholder — extend with model-specific condition`);
    lines.push('            satisfy true;');
  } else {
    lines.push(`            satisfy ${cond};`);
  }
  lines.push('        }');
  lines.push('    }');

  return lines.join('\n');
}

function generateCvl(binding) {
  const model = binding.model || 'unknown';
  const functions = binding.functions || [];
  const invariants = binding.invariants || [];

  const ghosts = computeRelevantGhosts(binding);
  const timestamp = new Date().toISOString();

  const out = [];
  out.push(`/// CVL specification generated from Counterflow binding`);
  out.push(`/// Model: ${model}`);
  out.push(`/// Generated: ${timestamp}`);
  out.push(`/// Source: Counterflow v0.3.0 — https://github.com/KryptosAI/counterflow`);
  out.push('');
  out.push('// ---- ghost variable declarations ----');

  if (ghosts.length > 0) {
    for (const g of ghosts) {
      out.push(g);
    }
  } else {
    out.push('// (no ghost variables needed — binding has no tracked effects)');
  }
  out.push('');

  if (functions.length > 0) {
    out.push('// ---- function transition rules ----');
    out.push('');
    for (let i = 0; i < functions.length; i++) {
      out.push(generateCvlRule(functions[i], i));
      if (i < functions.length - 1) out.push('');
    }
    out.push('');
  }

  if (invariants.length > 0) {
    out.push('// ---- invariant rules ----');
    out.push('');
    for (const inv of invariants) {
      const block = generateCvlInvariant(inv);
      if (block) {
        out.push(block);
        out.push('');
      }
    }
  }

  return out.join('\n') + '\n';
}

function exportCvl(bindingPath) {
  const fs = require('fs');
  const raw = fs.readFileSync(bindingPath, 'utf-8');
  let binding;
  try {
    binding = JSON.parse(raw);
  } catch {
    return { ok: false, error: `invalid JSON in binding file: ${bindingPath}` };
  }

  const v = validateBinding(binding);
  if (!v.valid) {
    return { ok: false, error: `binding validation failed: ${v.errors.join(', ')}` };
  }

  const cvl = generateCvl(binding);
  return { ok: true, cvl, model: binding.model };
}

module.exports = { generateCvl, exportCvl, computeRelevantGhosts };
