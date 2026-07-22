// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CreamFinance {
    mapping(address => uint256) public balances;
    uint256 public totalAssets;

    function deposit() external payable {
        balances[msg.sender] += msg.value;
        totalAssets += msg.value;
    }

    function borrow(uint256 amt) external {
        // BUG: no balance check — anyone can borrow, driving balance negative
        balances[msg.sender] -= amt;
        totalAssets -= amt;
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok);
    }
}
