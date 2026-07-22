// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title UnbackedMintVault — the owner can mint shares without depositing
/// any backing assets, silently diluting every holder (infinite-mint class).
contract UnbackedMintVault {
    address public owner;
    uint256 public totalAssets;
    uint256 public totalShares;
    mapping(address => uint256) public shares;

    constructor() { owner = msg.sender; }

    function deposit(uint256 amt) external {
        require(amt > 0, "zero amount");
        shares[msg.sender] += amt;
        totalShares += amt;
        totalAssets += amt;
    }

    function ownerMint(uint256 amt) external {
        require(msg.sender == owner, "not owner");
        // BUG: shares minted with no asset backing
        shares[msg.sender] += amt;
        totalShares += amt;
    }
}
