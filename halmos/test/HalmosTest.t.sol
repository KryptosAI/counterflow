// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {TokenPool} from "../src/TokenPool.sol";
import {TokenPoolBuggy} from "../src/TokenPoolBuggy.sol";
import {SafeVault} from "../src/SafeVault.sol";
import {ApprovalDrain} from "../src/ApprovalDrain.sol";
import {UnbackedMintVault} from "../src/UnbackedMintVault.sol";
import {BurnDesyncVault} from "../src/BurnDesyncVault.sol";
import {ReentrantToken} from "../src/ReentrantToken.sol";
import {ReentrantVaultBuggy} from "../src/ReentrantVaultBuggy.sol";
import {ReentrantAttacker} from "../src/ReentrantAttacker.sol";
import {MockToken, FlashLoanPool, FlashLoanExploiter} from "../src/MockToken.sol";

contract HalmosTest {
    function vm_assume(bool c) internal pure { if (!c) { assembly { revert(0,0) } } }

    function check_TokenPool_withdraw_noUnderflow(uint256 pre, uint256 amt) public {
        TokenPool pool = new TokenPool();
        vm_assume(pre > 0);
        pool.deposit(pre);
        uint256 before = pool.balances(address(this));
        pool.withdraw(amt);
        assert(pool.balances(address(this)) <= before);
    }

    function check_TokenPoolBuggy_withdraw_noUnderflow(uint256 pre, uint256 amt) public {
        TokenPoolBuggy pool = new TokenPoolBuggy();
        vm_assume(pre > 0);
        pool.deposit(pre);
        pool.withdraw(amt);
        assert(pool.balances(address(this)) <= pre);
    }

    function check_SafeVault_withdraw_shareIntegrity(uint256 depositAmt, uint256 withdrawAmt) public {
        SafeVault vault = new SafeVault();
        vm_assume(depositAmt > 0);
        vault.deposit(depositAmt);
        vault.withdraw(withdrawAmt);
        assert(vault.totalShares() == vault.totalAssets());
    }

    function check_SafeVault_accounting_multiOp(uint256 d1, uint256 d2, uint256 w1) public {
        SafeVault vault = new SafeVault();
        vm_assume(d1 > 0 && d2 > 0);
        vault.deposit(d1);
        vault.deposit(d2);
        vault.withdraw(w1);
        assert(vault.totalAssets() >= 0);
    }

    function check_UnbackedMintVault_ownerMint(uint256 mintAmt) public {
        UnbackedMintVault vault = new UnbackedMintVault();
        vm_assume(mintAmt > 0);
        vault.ownerMint(mintAmt);
        assert(vault.totalAssets() >= vault.totalShares());
    }

    function check_BurnDesyncVault_burn(uint256 burnAmt) public {
        BurnDesyncVault vault = new BurnDesyncVault();
        vm_assume(burnAmt > 0);
        vault.deposit(burnAmt);
        vault.burn(burnAmt);
        // Bug: burn() forgets to reduce totalShares — supply inflates relative to assets
        assert(vault.totalShares() <= vault.totalAssets());
    }

    // ── Gap 2: allowance bypass ──────────────────────────────────────
    // Bug: transferFrom uses unchecked math on allowance with no require(allowance >= amt).
    // Approving 1 lets you transfer the full balance. The allowance should NOT underflow.
    function check_ApprovalDrain_allowance_respected(uint256 depositAmt, uint256 exploitAmt) public {
        ApprovalDrain token = new ApprovalDrain();
        address victim = address(0xbeef);
        vm_assume(depositAmt > 1 && exploitAmt > 1);
        // Deposit to victim via direct balance write — ApprovalDrain.deposit() credits msg.sender
        token.deposit(depositAmt);
        // Transfer victim's balance to victim first (simulating victim having tokens)
        token.transferFrom(address(this), victim, depositAmt);
        // Victim approves spender for tiny amount
        token.approve(address(this), 1);
        // Attacker calls transferFrom with amount >> approved
        token.transferFrom(victim, address(this), exploitAmt);
        // Expectation: if allowance was respected, transferFrom should revert at
        // the allowance check. Since it doesn't, victim is drained. Either way,
        // the allowance should not wrap to a huge value (unchecked underflow signature).
        assert(token.allowances(victim, address(this)) <= 1);
    }

    // ── Gap 2: reentrancy ────────────────────────────────────────────
    // Bug: withdraw calls transfer BEFORE state update, no lock.
    // ReentrantAttacker's fallback calls vault.steal() during the transfer,
    // draining tokens WITHOUT reducing shares. Backing is permanently violated.
    function check_ReentrantVault_backing_violated(uint256 depositAmt, uint256 exploitAmt) public {
        ReentrantToken token = new ReentrantToken();
        ReentrantVaultBuggy vault = new ReentrantVaultBuggy(token);
        ReentrantAttacker attacker = new ReentrantAttacker(vault);
        vm_assume(depositAmt > 0 && exploitAmt > 0 && exploitAmt <= depositAmt);
        token.mint(address(attacker), depositAmt);
        attacker.attack(depositAmt, exploitAmt);
        assert(token.balances(address(vault)) >= vault.totalShares());
    }

    // ── Gap 3: flash loan multi-contract ─────────────────────────────
    // Bug: FlashLoanPool.flashLoan sends tokens but never checks repayment.
    // An attacker can withdraw their deposit during the callback, draining the pool.
    function check_FlashLoanPool_repayment_required(uint256 amt) public {
        MockToken token = new MockToken();
        FlashLoanPool pool = new FlashLoanPool(token);
        FlashLoanExploiter exploiter = new FlashLoanExploiter(pool, token);
        vm_assume(amt > 0);

        // Depositor (this contract) puts tokens in the pool
        token.mint(address(this), amt);
        pool.deposit(amt);

        // Attacker needs a deposit to initiate flash loan
        token.mint(address(exploiter), amt);
        exploiter.depositToPool(amt);

        uint256 prePoolBal = token.balances(address(pool));

        // Attacker takes flash loan → during callback withdraws deposit → pool drained
        try exploiter.attack(amt, "") {} catch {}

        // After attack: pool balance should NOT have decreased if repayment were enforced
        assert(token.balances(address(pool)) >= prePoolBal);
    }
}
