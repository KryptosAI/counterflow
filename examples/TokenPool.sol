// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title TokenPool — correct reference implementation
contract TokenPool {
    uint256 public totalAssets;
    mapping(address => uint256) public balances;

    function deposit(uint256 amt) external {
        require(amt > 0, "zero amount");
        balances[msg.sender] += amt;
        totalAssets += amt;
    }

    function withdraw(uint256 amt) external {
        require(amt > 0, "zero amount");
        require(balances[msg.sender] >= amt, "insufficient balance");
        balances[msg.sender] -= amt;
        totalAssets -= amt;
    }
}
