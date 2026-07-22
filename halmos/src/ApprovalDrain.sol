// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ApprovalDrain {
    uint256 public totalAssets;
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    function deposit(uint256 amt) external {
        require(amt > 0);
        balances[msg.sender] += amt;
        totalAssets += amt;
    }

    function approve(address spender, uint256 amt) external {
        allowances[msg.sender][spender] = amt;
    }

    function transferFrom(address src, address to, uint256 amt) external {
        unchecked {
            allowances[src][msg.sender] -= amt;
        }
        balances[src] -= amt;
        balances[to] += amt;
    }
}
