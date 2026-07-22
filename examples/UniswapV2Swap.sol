// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Simplified Uniswap V2 pair — constant-product AMM with swap and liquidity.
contract UniswapV2Swap {
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply; // LP tokens
    mapping(address => uint256) public balanceOf; // LP balances
    bool private locked;

    modifier lock() { require(!locked); locked = true; _; locked = false; }

    function swap(uint256 amount0Out, uint256 amount1Out) external lock {
        require(amount0Out > 0 || amount1Out > 0, "zero output");
        require(amount0Out < reserve0 && amount1Out < reserve1, "insufficient reserves");
        // Constant-product check: (r0 - out0) * (r1 - out1) >= r0 * r1
        require((reserve0 - amount0Out) * (reserve1 - amount1Out) >= reserve0 * reserve1, "k");
        if (amount0Out > 0) reserve0 -= amount0Out;
        if (amount1Out > 0) reserve1 -= amount1Out;
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external lock returns (uint256 shares) {
        require(amount0 > 0 && amount1 > 0, "zero");
        uint256 liquidity = amount0 + amount1;
        reserve0 += amount0;
        reserve1 += amount1;
        totalSupply += liquidity;
        balanceOf[msg.sender] += liquidity;
    }

    function removeLiquidity(uint256 shares) external lock {
        require(shares > 0 && balanceOf[msg.sender] >= shares, "insufficient");
        uint256 amount0 = (shares * reserve0) / totalSupply;
        uint256 amount1 = (shares * reserve1) / totalSupply;
        require(amount0 <= reserve0 && amount1 <= reserve1, "overflow");
        totalSupply -= shares;
        balanceOf[msg.sender] -= shares;
        reserve0 -= amount0;
        reserve1 -= amount1;
    }
}
