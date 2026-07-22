// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BurnDesyncVault — burn() reduces the caller's shares and pays out
/// assets, but forgets to reduce totalShares. Share supply desynchronizes
/// from actual holdings (accounting-desync class).
contract BurnDesyncVault {
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    function deposit(uint256 amt) external {
        require(amt > 0, "zero amount");
        shares[msg.sender] += amt;
        totalShares += amt;
        totalAssets += amt;
    }

    function burn(uint256 amt) external {
        require(shares[msg.sender] >= amt, "insufficient shares");
        shares[msg.sender] -= amt;
        // BUG: totalShares not reduced
        totalAssets -= amt; // checked: implicit totalAssets >= amt guard
    }
}
