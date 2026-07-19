// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoVault, IERC20} from "../src/DemoVault.sol";

/// Pure-logic tests with a mock ERC-20 (6-dec units). These do NOT model Arc
/// native semantics — chain behavior is exercised on the real testnet.
contract MockUsdc is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 v) external { balanceOf[to] += v; }
    function approve(address spender, uint256 v) external returns (bool) {
        allowance[msg.sender][spender] = v;
        return true;
    }
    function transfer(address to, uint256 v) external returns (bool) {
        require(balanceOf[msg.sender] >= v, "bal");
        balanceOf[msg.sender] -= v; balanceOf[to] += v;
        return true;
    }
    function transferFrom(address from, address to, uint256 v) external returns (bool) {
        require(balanceOf[from] >= v, "bal");
        require(allowance[from][msg.sender] >= v, "allow");
        allowance[from][msg.sender] -= v;
        balanceOf[from] -= v; balanceOf[to] += v;
        return true;
    }
}

interface Vm {
    function expectRevert(bytes calldata) external;
}

contract DemoVaultTest {
    Vm constant vm = Vm(0x7109709ECfa91a80626fF3989D68f67F5b1DD12D);
    MockUsdc usdc;
    DemoVault vault;

    function setUp() public {
        usdc = new MockUsdc();
        vault = new DemoVault(IERC20(address(usdc)));
        usdc.mint(address(this), 1_000_000_000); // 1000 USDC in 6-dec
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_depositWithdrawRoundTrip() public {
        vault.deposit(15_000_000); // 15.00 USDC
        require(vault.balanceOfAssets(address(this)) == 15_000_000, "shares");
        require(usdc.balanceOf(address(vault)) == 15_000_000, "vault bal");
        vault.withdraw(15_000_000);
        require(vault.balanceOfAssets(address(this)) == 0, "shares zero");
        require(usdc.balanceOf(address(this)) == 1_000_000_000, "all back");
    }

    function test_sharesAreOneToOne_noYieldPretended() public {
        vault.deposit(1);
        vault.deposit(2);
        require(vault.balanceOfAssets(address(this)) == 3, "1:1");
        require(vault.totalShares() == 3, "total");
    }

    function test_zeroDepositReverts() public {
        vm.expectRevert(bytes("zero deposit"));
        vault.deposit(0);
    }

    function test_overWithdrawReverts() public {
        vault.deposit(5);
        vm.expectRevert(bytes("insufficient shares"));
        vault.withdraw(6);
    }
}
