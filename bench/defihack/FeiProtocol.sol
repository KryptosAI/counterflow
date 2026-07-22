// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract FeiProtocol {
    mapping(address => uint256) public balances;
    uint256 public totalAssets;
    bool private locked;

    modifier nonReentrant() { require(!locked, "REENTRANT"); locked = true; _; locked = false; }

    function deposit() external payable nonReentrant {
        balances[msg.sender] += msg.value;
        totalAssets += msg.value;
    }

    function withdraw(uint256 amt) external {
        // BUG: no reentrancy lock — the guard `not_locked` is MISSING
        require(balances[msg.sender] >= amt, "insufficient");
        (bool ok,) = msg.sender.call{value: amt}("");
        require(ok, "transfer failed");
        // State update AFTER external call (violates checks-effects-interactions)
        balances[msg.sender] -= amt;
        totalAssets -= amt;
    }
}
