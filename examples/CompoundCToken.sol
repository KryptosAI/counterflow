// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Simplified Compound cToken — mint/redeem/borrow/repay with exchange rate tracking.
contract CompoundCToken {
    mapping(address => uint256) public cTokenBalance;
    mapping(address => uint256) public underlyingBalance;
    mapping(address => uint256) public debt;
    uint256 public totalCTokens;
    uint256 public totalUnderlying;
    uint256 public totalDebt;
    uint256 public exchangeRate = 1e18; // 1:1 initially
    uint256 public constant LIQ_THRESHOLD = 8000; // 80% in bps

    function mint(uint256 underlyingAmt) external {
        require(underlyingAmt > 0);
        underlyingBalance[msg.sender] += underlyingAmt;
        totalUnderlying += underlyingAmt;
        uint256 cTokens = (underlyingAmt * 1e18) / exchangeRate;
        cTokenBalance[msg.sender] += cTokens;
        totalCTokens += cTokens;
    }

    function redeem(uint256 cTokenAmt) external {
        require(cTokenBalance[msg.sender] >= cTokenAmt);
        uint256 underlyingAmt = (cTokenAmt * exchangeRate) / 1e18;
        require(totalUnderlying >= underlyingAmt);
        cTokenBalance[msg.sender] -= cTokenAmt;
        totalCTokens -= cTokenAmt;
        underlyingBalance[msg.sender] -= underlyingAmt;
        totalUnderlying -= underlyingAmt;
    }

    function borrow(uint256 amt) external {
        require(amt > 0);
        uint256 collateralValue = (cTokenBalance[msg.sender] * exchangeRate) / 1e18;
        require(collateralValue * LIQ_THRESHOLD >= (debt[msg.sender] + amt) * 10000, "undercollateralized");
        require(totalUnderlying >= amt, "insufficient pool liquidity");
        debt[msg.sender] += amt;
        totalDebt += amt;
        underlyingBalance[msg.sender] += amt;
        totalUnderlying -= amt;
    }

    function repay(uint256 amt) external {
        require(amt > 0);
        require(underlyingBalance[msg.sender] >= amt);
        require(debt[msg.sender] >= amt);
        underlyingBalance[msg.sender] -= amt;
        debt[msg.sender] -= amt;
        totalDebt -= amt;
        totalUnderlying += amt;
    }

    function accrueInterest(uint256 newRate) external {
        require(newRate >= exchangeRate); // rate only increases
        exchangeRate = newRate;
    }
}
