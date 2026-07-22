// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title SafeVault — correct reference vault: every share is asset-backed,
/// mint/burn keep per-user shares, share supply, and assets in lockstep.
contract SafeVault {
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    function deposit(uint256 amt) external {
        require(amt > 0, "zero amount");
        shares[msg.sender] += amt;
        totalShares += amt;
        totalAssets += amt;
    }

    function withdraw(uint256 amt) external {
        require(amt > 0, "zero amount");
        require(shares[msg.sender] >= amt, "insufficient shares");
        shares[msg.sender] -= amt;
        totalShares -= amt;
        totalAssets -= amt;
    }
}
