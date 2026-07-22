// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract CurveStableSwap {
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    bool private locked;

    modifier lock() { require(!locked); locked = true; _; locked = false; }

    function exchange(int128 i, int128 j, uint256 dx, uint256 min_dy) external lock returns (uint256) {
        require(i != j && dx > 0);
        uint256 dy;
        if (i == 0 && j == 1) {
            dy = (dx * reserve1) / (reserve0 + dx);
            require(dy >= min_dy && dy < reserve1);
            reserve0 += dx;
            reserve1 -= dy;
        } else if (i == 1 && j == 0) {
            dy = (dx * reserve0) / (reserve1 + dx);
            require(dy >= min_dy && dy < reserve0);
            reserve1 += dx;
            reserve0 -= dy;
        } else {
            revert("invalid pair");
        }
        return dy;
    }

    function addLiquidity(uint256 amount0, uint256 amount1) external lock returns (uint256 shares) {
        require(amount0 > 0 && amount1 > 0);
        shares = amount0 + amount1;
        reserve0 += amount0;
        reserve1 += amount1;
        totalSupply += shares;
        balanceOf[msg.sender] += shares;
    }

    function removeLiquidity(uint256 shares) external lock {
        require(shares > 0 && balanceOf[msg.sender] >= shares);
        uint256 amount0 = (shares * reserve0) / totalSupply;
        uint256 amount1 = (shares * reserve1) / totalSupply;
        totalSupply -= shares;
        balanceOf[msg.sender] -= shares;
        reserve0 -= amount0;
        reserve1 -= amount1;
    }
}
