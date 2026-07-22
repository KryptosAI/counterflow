const EFFECTS_NEED_TO_ADDR = ['bal_add_amt_to'];
const EFFECTS_NEED_SRC_ADDR = ['bal_sub_amt_src', 'allowance_sub_amt', 'allowance_set_zero'];

function hasEffect(fn, prefix) {
  return (fn.effects || []).some((e) => e === prefix || e.startsWith(prefix));
}

function needsAddressTo(fn) {
  return EFFECTS_NEED_TO_ADDR.some((p) => hasEffect(fn, p));
}

function needsAddressSrc(fn) {
  return EFFECTS_NEED_SRC_ADDR.some((p) => hasEffect(fn, p));
}

function handlerParamDef(fn) {
  const params = [];
  if (needsAddressTo(fn)) params.push('address to');
  if (needsAddressSrc(fn)) params.push('address src');
  params.push('uint256 amt');
  return params.join(', ');
}

function handlerCallArgs(fn) {
  const args = [];
  if (needsAddressTo(fn)) args.push('to');
  if (needsAddressSrc(fn)) args.push('src');
  args.push('amt');
  return args.join(', ');
}

function hasAnyBalanceEffect(fn) {
  return ['bal_add_amt', 'bal_sub_amt', 'bal_add_amt_to', 'bal_sub_amt_src', 'set_bal_zero'].some((e) => hasEffect(fn, e));
}

function hasAnySharesEffect(fn) {
  return ['shares_add_amt', 'shares_sub_amt'].some((e) => hasEffect(fn, e));
}

function hasAnyBalanceOrSharesEffect(fn) {
  return hasAnyBalanceEffect(fn) || hasAnySharesEffect(fn);
}

function ghostUpdateForEffect(e) {
  switch (e) {
    case 'bal_add_amt':
      return 'ghost_sumBalances += amt;';
    case 'bal_sub_amt':
      return 'ghost_sumBalances -= amt;';
    case 'bal_add_amt_to':
      return 'ghost_sumBalances += amt;';
    case 'bal_sub_amt_src':
      return 'ghost_sumBalances -= amt;';
    case 'set_bal_zero':
      return 'ghost_sumBalances -= balances[msg.sender];';
    case 'shares_add_amt':
      return 'ghost_sumShares += amt;';
    case 'shares_sub_amt':
      return 'ghost_sumShares -= amt;';
    default:
      return '';
  }
}

function indent(level) {
  return ' '.repeat(level * 4);
}

function generateHandlerSource(binding, contractName) {
  const handlerName = contractName + 'Handler';
  const functions = binding.functions || [];
  const hasBalances = functions.some(hasAnyBalanceEffect);
  const hasShares = functions.some(hasAnySharesEffect);

  const out = [];
  out.push('// SPDX-License-Identifier: MIT');
  out.push('pragma solidity ^0.8.20;');
  out.push('');
  out.push('import {' + contractName + '} from "./' + contractName + '.sol";');
  out.push('');
  out.push('contract ' + handlerName + ' is ' + contractName + ' {');

  if (hasBalances) {
    out.push(indent(1) + 'uint256 public ghost_sumBalances;');
  }
  if (hasShares) {
    out.push(indent(1) + 'uint256 public ghost_sumShares;');
  }
  out.push(indent(1) + 'address[] public actors;');
  out.push(indent(1) + 'mapping(address => bool) public isActor;');

  for (const fn of functions) {
    out.push('');
    const params = handlerParamDef(fn);
    out.push(indent(1) + 'function ' + fn.name + '(' + params + ') public override {');

    const callArgs = handlerCallArgs(fn);

    if (hasEffect(fn, 'set_bal_zero')) {
      out.push(indent(2) + 'uint256 _prevBal = balances[msg.sender];');
    }

    out.push(indent(2) + 'super.' + fn.name + '(' + callArgs + ');');

    let hasGhost = false;
    for (const e of (fn.effects || [])) {
      const upd = ghostUpdateForEffect(e);
      if (upd) {
        out.push(indent(2) + upd);
        hasGhost = true;
      }
    }

    if (hasAnyBalanceOrSharesEffect(fn) || hasGhost) {
      out.push(indent(2) + 'if (!isActor[msg.sender]) {');
      out.push(indent(3) + 'isActor[msg.sender] = true;');
      out.push(indent(3) + 'actors.push(msg.sender);');
      out.push(indent(2) + '}');
    }

    out.push(indent(1) + '}');
  }

  out.push('');
  out.push(indent(1) + 'function actorsLength() public view returns (uint256) {');
  out.push(indent(2) + 'return actors.length;');
  out.push(indent(1) + '}');
  out.push('}');
  out.push('');

  return out.join('\n');
}

function usesContractField(binding, field) {
  const functions = binding.functions || [];
  const prefixes = {
    balances: ['bal_add_amt', 'bal_sub_amt', 'bal_add_amt_to', 'bal_sub_amt_src', 'set_bal_zero'],
    shares: ['shares_add_amt', 'shares_sub_amt'],
    totalAssets: ['total_add_amt', 'total_sub_amt'],
    totalShares: ['total_shares_add_amt', 'total_shares_sub_amt'],
    allowances: ['allowance_sub_amt', 'allowance_set_zero'],
  };
  const matchPrefixes = prefixes[field] || [];
  return functions.some((fn) => matchPrefixes.some((p) => hasEffect(fn, p)));
}

function invariantToSolidity(inv, handlerName, binding) {
  const ib = indent(2);
  const hasBalances = usesContractField(binding, 'balances');
  const hasShares = usesContractField(binding, 'shares');
  const hasTotalAssets = usesContractField(binding, 'totalAssets');
  const hasTotalShares = usesContractField(binding, 'totalShares');
  const hasAllowances = usesContractField(binding, 'allowances');

  switch (inv) {
    case 'nonneg_balance':
      if (!hasBalances) return ib + '// nonneg_balance: no balance effects — skipped';
      return [
        ib + 'for (uint256 i = 0; i < handler.actorsLength(); i++) {',
        ib + '    address a = handler.actors(i);',
        ib + '    assertGe(handler.balances(a), 0);',
        ib + '}',
      ].join('\n');

    case 'nonneg_shares':
      if (!hasShares) return ib + '// nonneg_shares: no share effects — skipped';
      return [
        ib + 'for (uint256 i = 0; i < handler.actorsLength(); i++) {',
        ib + '    address a = handler.actors(i);',
        ib + '    assertGe(handler.shares(a), 0);',
        ib + '}',
      ].join('\n');

    case 'nonneg_allowance':
      if (!hasAllowances) return ib + '// nonneg_allowance: no allowance effects — skipped';
      return [
        ib + 'for (uint256 i = 0; i < handler.actorsLength(); i++) {',
        ib + '    address a = handler.actors(i);',
        ib + '    for (uint256 j = 0; j < handler.actorsLength(); j++) {',
        ib + '        address b = handler.actors(j);',
        ib + '        assertGe(handler.allowances(a, b), 0);',
        ib + '    }',
        ib + '}',
      ].join('\n');

    case 'nonneg_total':
      if (!hasTotalAssets) return ib + '// nonneg_total: no total asset effects — skipped';
      return ib + 'assertGe(handler.totalAssets(), 0);';

    case 'nonneg_total_shares':
      if (!hasTotalShares) return ib + '// nonneg_total_shares: no total share effects — skipped';
      return ib + 'assertGe(handler.totalShares(), 0);';

    case 'solvency':
      if (!hasBalances || !hasTotalAssets) return ib + '// solvency: missing balances or totalAssets — skipped';
      return ib + 'assertEq(handler.ghost_sumBalances(), handler.totalAssets());';

    case 'shares_integrity':
      if (!hasShares || !hasTotalShares) return ib + '// shares_integrity: missing shares or totalShares — skipped';
      return ib + 'assertEq(handler.ghost_sumShares(), handler.totalShares());';

    case 'backing':
      if (!hasTotalAssets || !hasTotalShares) return ib + '// backing: missing totalAssets or totalShares — skipped';
      return ib + 'assertGe(handler.totalAssets(), handler.totalShares());';

    case 'supply_cap':
      return [
        ib + '// supply_cap: CAP must be defined on the target contract',
        ib + 'assertLe(handler.totalAssets(), handler.CAP());',
      ].join('\n');

    case 'reentrancy_safe':
      return [
        ib + '// reentrancy_safe: not easily tested in Foundry invariant tests.',
        ib + '// Use Medusa/Echidna with reentrancy detection or deploy a',
        ib + '// malicious receiver contract that re-enters the handler.',
      ].join('\n');

    default:
      return ib + '// unknown invariant: ' + inv;
  }
}

function generateInvariantsSource(binding, contractName) {
  const handlerName = contractName + 'Handler';
  const invariants = binding.invariants || [];

  const out = [];
  out.push('// SPDX-License-Identifier: MIT');
  out.push('pragma solidity ^0.8.20;');
  out.push('');
  out.push('import {Test} from "forge-std/Test.sol";');
  out.push('import {' + handlerName + '} from "./' + handlerName + '.sol";');
  out.push('');
  out.push('contract ' + contractName + 'Invariants is Test {');
  out.push(indent(1) + handlerName + ' handler;');
  out.push('');
  out.push(indent(1) + 'function setUp() public {');
  out.push(indent(2) + 'handler = new ' + handlerName + '();');
  out.push(indent(1) + '}');

  for (const inv of invariants) {
    out.push('');
    out.push(indent(1) + 'function invariant_' + inv + '() public {');
    out.push(invariantToSolidity(inv, handlerName, binding));
    out.push(indent(1) + '}');
  }

  out.push('');
  out.push('}');
  out.push('');

  return out.join('\n');
}

function generateConfig(binding, contractName) {
  const invs = (binding.invariants || []).join(', ');
  return [
    '# Foundry config snippet — place in foundry.toml or via medusa.json',
    '#',
    '# [profile.default]',
    '# src = "src"',
    '# test = "test"',
    '# solc = "0.8.24"',
    '#',
    '# For Medusa fuzzing campaigns:',
    '# {',
    '#   "fuzzing": {',
    '#     "workers": 4,',
    '#     "testLimit": 100000,',
    '#     "callSequenceLength": 50',
    '#   },',
    '#   "targetContracts": ["' + contractName + 'Handler"],',
    '#   "invariantContracts": ["' + contractName + 'Invariants"]',
    '# }',
    '#',
    '# Invariants: ' + invs,
  ].join('\n');
}

function renderSolidity(binding, contractName) {
  return {
    handler: generateHandlerSource(binding, contractName),
    invariants: generateInvariantsSource(binding, contractName),
    config: generateConfig(binding, contractName),
  };
}

function generateFoundryHandler(binding, contractName) {
  return generateHandlerSource(binding, contractName);
}

function generateFoundryInvariants(binding, contractName) {
  return generateInvariantsSource(binding, contractName);
}

module.exports = {
  generateFoundryHandler,
  generateFoundryInvariants,
  renderSolidity,
};
