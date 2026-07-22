// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract PancakeBunny {
    mapping(address => uint256) public shares;
    uint256 public totalShares;
    uint256 public totalAssets;

    function deposit(uint256 amt) external {
        require(amt > 0);
        shares[msg.sender] += amt;
        totalShares += amt;
        totalAssets += amt;
    }

    function mintShares(uint256 amt) external {
        // BUG: mints shares without adding assets — inflates supply, breaks 1:1 backing
        shares[msg.sender] += amt;
        totalShares += amt;
    }

    function redeem(uint256 shareAmt) external {
        require(shares[msg.sender] >= shareAmt);
        uint256 assetAmt = shareAmt;
        shares[msg.sender] -= shareAmt;
        totalShares -= shareAmt;
        totalAssets -= assetAmt;
    }
}
