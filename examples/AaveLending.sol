// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Simplified Aave lending pool — deposit collateral, borrow, repay, liquidate.
contract AaveLending {
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;
    mapping(address => uint256) public balance;
    uint256 public totalCollateral;
    uint256 public totalDebt;
    uint256 public totalAssets;
    uint256 public constant LIQ_THRESHOLD = 8000; // 80% in bps
    bool private locked;

    modifier lock() { require(!locked); locked = true; _; locked = false; }

    function deposit(uint256 amt) external lock {
        require(amt > 0);
        balance[msg.sender] += amt;
        totalAssets += amt;
    }

    function depositCollateral(uint256 amt) external lock {
        require(balance[msg.sender] >= amt);
        balance[msg.sender] -= amt;
        collateral[msg.sender] += amt;
        totalCollateral += amt;
    }

    function borrow(uint256 amt) external lock {
        require(collateral[msg.sender] * LIQ_THRESHOLD >= (debt[msg.sender] + amt) * 10000, "undercollateralized");
        debt[msg.sender] += amt;
        totalDebt += amt;
        balance[msg.sender] += amt;
    }

    function repay(uint256 amt) external lock {
        require(balance[msg.sender] >= amt && debt[msg.sender] >= amt);
        balance[msg.sender] -= amt;
        debt[msg.sender] -= amt;
        totalDebt -= amt;
    }

    function withdrawCollateral(uint256 amt) external lock {
        require(collateral[msg.sender] >= amt);
        uint256 newCollateral = collateral[msg.sender] - amt;
        require(newCollateral * LIQ_THRESHOLD >= debt[msg.sender] * 10000, "undercollateralized");
        collateral[msg.sender] = newCollateral;
        totalCollateral -= amt;
        balance[msg.sender] += amt;
    }
}
