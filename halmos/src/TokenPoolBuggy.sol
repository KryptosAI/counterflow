// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TokenPoolBuggy — withdraw() is missing the balance check AND uses
/// unchecked arithmetic, so the subtraction wraps instead of reverting.
/// This is the classic accounting bug behind many real drains: any caller can
/// withdraw more than they deposited.
contract TokenPoolBuggy {
    uint256 public totalAssets;
    mapping(address => uint256) public balances;

    function deposit(uint256 amt) external {
        require(amt > 0, "zero amount");
        balances[msg.sender] += amt;
        totalAssets += amt;
    }

    function withdraw(uint256 amt) external {
        require(amt > 0, "zero amount");
        // BUG: no `require(balances[msg.sender] >= amt)` and unchecked math
        unchecked {
            balances[msg.sender] -= amt;
            totalAssets -= amt;
        }
    }
}
