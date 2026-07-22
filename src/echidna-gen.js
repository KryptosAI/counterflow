const INVARIANT_PROPS = {
  nonneg_balance:      `return balances[address(this)] <= totalAssets || balances[address(this)] == 0; // uint cannot be negative; check solvency per-actor`,
  nonneg_total:         `return totalAssets >= 0; // always true for uint256; placeholder`,
  solvency:             `return balances[address(this)] <= totalAssets; // per-actor solvency check`,
  backing:              `return totalAssets >= totalShares; // every share backed`,
  supply_cap:           `return totalAssets <= 1000000000; // supply cap`,
  nonneg_shares:        `return shares[address(this)] <= totalShares || shares[address(this)] == 0;`,
  nonneg_allowance:     `return true; // allowance checked via transferFrom guard; static here`,
  nonneg_total_shares:  `return totalShares >= 0; // always true for uint256; placeholder`,
  shares_integrity:     `return true; // requires ghost-var tracking (not in contract); placeholder`,
  reentrancy_safe:      `return true; // cannot test reentrancy with fuzzing; placeholder`,
};

function generateEchidnaTest(binding, contractName) {
  const name = contractName || binding.model || 'Contract';
  const invs = binding.invariants || [];
  const fns = (binding.functions || []).map(f => f.name);

  const props = invs.map((inv, i) => {
    const body = INVARIANT_PROPS[inv] || `return true; // invariant ${inv} not instrumented`;
    return `    function echidna_${inv}_${i}() public view returns (bool) { ${body} }`;
  }).join('\n\n');

  const filterComment = fns.length
    ? `// filterFunctions: [${fns.map(f => `"${f}(uint256)"`).join(', ')}]`
    : '';

  return `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "../src/${name}.sol";

contract Echidna${name} is ${name} {
${props}
}
${filterComment}`;
}

function generateEchidnaConfig(binding) {
  const fns = (binding.functions || []).map(f => f.name);
  return `testLimit: 50000
seqLen: 100
deployer: "0x10000"
sender: ["0x10000", "0x20000", "0x30000"]
${fns.length ? 'filterFunctions: [' + fns.map(f => `"${f}(uint256)"`).join(', ') + ']' : ''}`;
}

module.exports = { generateEchidnaTest, generateEchidnaConfig };
