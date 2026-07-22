// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title ApprovalDrain — transferFrom decrements the allowance inside an
/// unchecked block WITHOUT checking it first. Any approved spender (even for
/// 1 wei) can move the victim's entire balance: the classic
/// missing-allowance-check exploit.
contract ApprovalDrain {
    uint256 public totalAssets;
    mapping(address => uint256) public balances;
    mapping(address => mapping(address => uint256)) public allowances;

    function approve(address spender, uint256 amt) external {
        allowances[msg.sender][spender] = amt;
    }

    function transferFrom(address src, address to, uint256 amt) external {
        // BUG: allowance never validated before decrement, and unchecked math
        unchecked {
            allowances[src][msg.sender] -= amt;
        }
        balances[src] -= amt; // checked: implicit balances[src] >= amt guard
        balances[to] += amt;
    }
}
