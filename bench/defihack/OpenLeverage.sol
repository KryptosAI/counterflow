// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract OpenLeverage {
    mapping(address => uint256) public collateral;
    mapping(address => uint256) public debt;
    uint256 public totalAssets;

    function deposit() external payable {
        collateral[msg.sender] += msg.value;
        totalAssets += msg.value;
    }

    function liquidate(address user) external {
        // BUG: no access control — anyone can call liquidate, receives user's collateral
        uint256 seized = collateral[user];
        collateral[user] = 0;
        totalAssets -= seized;
        (bool ok,) = msg.sender.call{value: seized}("");
        require(ok);
    }
}
