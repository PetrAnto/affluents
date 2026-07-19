// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function transferFrom(address from, address to, uint256 value) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @title DemoVault — Affluents Earn bucket (honest demo position)
/// @notice Minimal ERC-4626-style vault over the USDC ERC-20 interface
///         (6-decimal units). Holds deposits 1:1 — no yield is generated or
///         claimed; the UI labels this "Demo Vault — on-chain position".
///         Withdrawals are permissionless for the depositor.
contract DemoVault {
    IERC20 public immutable asset;
    mapping(address => uint256) public sharesOf;
    uint256 public totalShares;

    event Deposit(address indexed owner, uint256 assetsUsdc6);
    event Withdraw(address indexed owner, uint256 assetsUsdc6);

    constructor(IERC20 asset_) {
        asset = asset_;
    }

    /// @param assetsUsdc6 amount in 6-decimal ERC-20 USDC units
    function deposit(uint256 assetsUsdc6) external {
        require(assetsUsdc6 > 0, "zero deposit");
        require(asset.transferFrom(msg.sender, address(this), assetsUsdc6), "transferFrom failed");
        sharesOf[msg.sender] += assetsUsdc6; // 1:1 shares, no yield pretended
        totalShares += assetsUsdc6;
        emit Deposit(msg.sender, assetsUsdc6);
    }

    function withdraw(uint256 assetsUsdc6) external {
        uint256 shares = sharesOf[msg.sender];
        require(assetsUsdc6 > 0 && assetsUsdc6 <= shares, "insufficient shares");
        sharesOf[msg.sender] = shares - assetsUsdc6;
        totalShares -= assetsUsdc6;
        require(asset.transfer(msg.sender, assetsUsdc6), "transfer failed");
        emit Withdraw(msg.sender, assetsUsdc6);
    }

    function balanceOfAssets(address owner) external view returns (uint256) {
        return sharesOf[owner];
    }
}
