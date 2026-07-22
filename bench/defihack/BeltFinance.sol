// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract BeltFinance {
    mapping(address => uint256) public balances;
    uint256 public totalAssets;

    function deposit(uint256 amt) external {
        require(amt > 0);
        balances[msg.sender] += amt;
        totalAssets += amt;
    }

    function withdraw(uint256 amt) external {
        require(amt > 0);
        // BUG: no balance check — amt can exceed balance, causing unchecked integer overflow
        balances[msg.sender] -= amt;
        totalAssets -= amt;
    }
}
