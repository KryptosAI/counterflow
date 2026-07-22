// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Reentrant ERC20-like token that calls back to the sender on transfer.
contract ReentrantToken {
    mapping(address => uint256) public balances;
    uint256 public totalSupply;
    bool public callbackEnabled = true;

    function mint(address to, uint256 amt) external {
        balances[to] += amt;
        totalSupply += amt;
    }

    function transfer(address to, uint256 amt, bytes calldata data) external returns (bool) {
        require(balances[msg.sender] >= amt);
        balances[msg.sender] -= amt;
        balances[to] += amt;
        if (callbackEnabled && data.length > 0) {
            (bool ok,) = to.call(data);
            ok;
        }
        return true;
    }
}
