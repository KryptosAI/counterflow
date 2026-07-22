// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrantToken} from "./ReentrantToken.sol";

// Exploitable vault: withdraw sends tokens BEFORE state update, no reentrancy lock.
// The reentrancy path: attacker calls withdraw → during callback calls steal()
// which drains tokens WITHOUT reducing shares. Backing invariant is violated.
contract ReentrantVaultBuggy {
    ReentrantToken public token;
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalAssets;

    constructor(ReentrantToken _token) { token = _token; }

    function deposit(uint256 amt) external {
        token.mint(address(this), amt);
        shares[msg.sender] += amt;
        totalShares += amt;
        totalAssets += amt;
    }

    function withdraw(uint256 amt, bytes calldata data) external {
        require(shares[msg.sender] >= amt);
        token.transfer(msg.sender, amt, data);
        shares[msg.sender] -= amt;
        totalShares -= amt;
        totalAssets -= amt;
    }

    // Missing check: withdraws tokens without reducing any accounting.
    // Exploitable via reentrancy during withdraw's external call.
    function steal(uint256 amt) external {
        token.transfer(msg.sender, amt, "");
    }
}

contract VictimDepositor {
    ReentrantToken public token;

    constructor(ReentrantToken _token) { token = _token; }

    function depositTo(ReentrantVaultBuggy vault) external payable {
        vault.deposit(1 ether);
    }
}
