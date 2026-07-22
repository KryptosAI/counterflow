"""
Trusted semantic core for Counterflow.

This module is the SOUND, HUMAN-AUDITED part of the pipeline. The LLM never
decides a verdict; it only emits a structured abstraction (a "binding") drawn
from the fixed vocabularies below.

Model types (selected via "model" field in binding):
    erc20_pool     — ERC20 + ERC4626 + approvals (original)
    amm_pool       — AMM/DEX (constant-product swap + liquidity)
    lending_pool   — Lending protocol (collateral + debt + health factor)
    staking_pool   — Staking protocol (stake + unstake + rewards)
    cross_contract — Multi-contract (cross-contract call coherence)

All model types share the base ERC20 vocabulary and add domain-specific
extensions. The LLM is free to choose whichever model best fits the contract.

State model (full union):
    Base ERC20:
        totalAssets, totalShares, balances[a], shares[a], allowances[a]
        sumBalances (ghost), sumShares (ghost)
        locks[f], in_call, snapshot_total, snapshot_sum_bal
    AMM:
        reserveX, reserveY, lpSupply, lpBalances[a], sumLpBal (ghost), initialK
    Lending:
        collateral[a], debt[a], totalCollateral, totalDebt
        sumCollateral (ghost), sumDebt (ghost), liqThreshold
    Staking:
        staked[a], rewards[a], totalStaked, sumStaked (ghost)
        rewardPool, sumRewards (ghost)
    Cross-contract:
        cross_in_progress, cross_snapshot_total, cross_snapshot_sum_bal

Soundness notes
---------------
1. Ghost sums are sound: sum(Store(b, i, b[i] ± k)) = sum(b) ± k.
2. Quantified invariants checked at all touched indices with ForAll hypothesis.
3. Background axiom: nonneg entries => each entry <= its sum.
4. Inductive hypothesis assumes the FULL CONJUNCTION of selected invariants.
"""
from z3 import (
    Int, Array, IntSort, Select, Store, ForAll, Implies, And, Not,
    Solver, sat, unsat, IntVal, K,
)

CAP = 1_000_000_000
BPB = 10_000  # basis points

# ── Vocabulary (union of all model types) ───────────────────────────────

GUARDS = {
    # ERC20 base
    "amt_gt_0", "bal_ge_amt", "bal_gt_0", "total_ge_amt",
    "sender_is_owner", "bal_src_ge_amt", "allowance_ge_amt",
    "shares_ge_amt", "total_shares_ge_amt",
    "not_locked", "balance_unchanged_before_call",
    # AMM
    "dx_gt_0", "dy_gt_0", "reserveX_ge_dx", "reserveY_ge_dy", "lp_ge_amt",
    # Lending
    "collateral_ge_amt", "debt_ge_amt", "healthy_position",
    # Staking
    "staked_ge_amt", "rewards_ge_amt",
    # Cross-contract
    "cross_not_in_progress", "cross_snapshot_match",
    # Oracle
    "price_ge_min", "price_valid", "twap_stale",
    # Governance
    "timelock_expired",
}

EFFECTS = {
    # ERC20 base
    "bal_add_amt", "bal_sub_amt", "bal_add_amt_to", "bal_sub_amt_src",
    "set_bal_zero", "total_add_amt", "total_sub_amt",
    "shares_add_amt", "shares_sub_amt",
    "total_shares_add_amt", "total_shares_sub_amt",
    "allowance_sub_amt", "allowance_set_zero",
    "reentrancy_lock_acquire", "reentrancy_lock_release", "external_call",
    # AMM
    "reserveX_add", "reserveX_sub", "reserveY_add", "reserveY_sub",
    "lp_mint_amt", "lp_burn_amt", "lp_add_amt_to", "lp_sub_amt_src",
    # Lending
    "collateral_add", "collateral_sub", "debt_add", "debt_sub",
    "total_collateral_add", "total_collateral_sub",
    "total_debt_add", "total_debt_sub",
    # Staking
    "stake_add", "stake_sub", "reward_mint", "reward_claim",
    "total_staked_add", "total_staked_sub",
    # Cross-contract
    "cross_contract_call", "cross_contract_return",
    # Oracle
    "price_update", "oracle_manipulate",
    # Governance
    "proposal_execute",
}

INVARIANTS = {
    # ERC20 base
    "nonneg_balance", "nonneg_shares", "nonneg_allowance",
    "nonneg_total", "nonneg_total_shares",
    "solvency", "shares_integrity", "backing", "supply_cap",
    "reentrancy_safe",
    # AMM
    "nonneg_reserves", "nonneg_lp", "constant_product",
    "lp_integrity", "backing_amm",
    # Lending
    "nonneg_collateral", "nonneg_debt",
    "nonneg_total_collateral", "nonneg_total_debt",
    "collateral_integrity", "debt_integrity",
    "overcollateralized", "lending_solvency",
    # Staking
    "nonneg_staked", "nonneg_rewards",
    "stake_integrity", "reward_integrity", "staking_backing",
    # Cross-contract
    "cross_contract_safe",
    # Oracle
    "nonneg_price", "price_stability", "oracle_integrity",
    # Governance
    "nonneg_timelock",
}


# ── State ───────────────────────────────────────────────────────────────

class State:
    def __init__(self, total, total_shares, bal, shr, allow, sum_bal, sum_shr,
                 locks=None, in_call=None, snapshot_total=None, snapshot_sum_bal=None,
                 reserveX=None, reserveY=None, lpSupply=None, lpBal=None,
                 sumLpBal=None, initialK=None,
                 collateral=None, debt=None, totalCollateral=None, totalDebt=None,
                 sumCollateral=None, sumDebt=None, liqThreshold=None,
                 staked=None, rewards_arr=None, totalStaked=None, sumStaked=None,
                 rewardPool=None, sumRewards=None,
                 cross_in_progress=None, cross_snapshot_total=None,
                 cross_snapshot_sum_bal=None,
                 price=None, twap_age=None, timelock_time=None):
        z = IntVal(0)
        self.total = total
        self.total_shares = total_shares
        self.bal = bal
        self.shr = shr
        self.allow = allow
        self.sum_bal = sum_bal
        self.sum_shr = sum_shr
        self.locks = locks if locks is not None else K(IntSort(), z)
        self.in_call = in_call if in_call is not None else z
        self.snapshot_total = snapshot_total if snapshot_total is not None else z
        self.snapshot_sum_bal = snapshot_sum_bal if snapshot_sum_bal is not None else z
        self.reserveX = reserveX if reserveX is not None else z
        self.reserveY = reserveY if reserveY is not None else z
        self.lpSupply = lpSupply if lpSupply is not None else z
        self.lpBal = lpBal if lpBal is not None else K(IntSort(), z)
        self.sumLpBal = sumLpBal if sumLpBal is not None else z
        self.initialK = initialK if initialK is not None else z
        self.collateral = collateral if collateral is not None else K(IntSort(), z)
        self.debt_arr = debt if debt is not None else K(IntSort(), z)
        self.totalCollateral = totalCollateral if totalCollateral is not None else z
        self.totalDebt = totalDebt if totalDebt is not None else z
        self.sumCollateral = sumCollateral if sumCollateral is not None else z
        self.sumDebt = sumDebt if sumDebt is not None else z
        self.liqThreshold = liqThreshold if liqThreshold is not None else IntVal(BPB)
        self.staked = staked if staked is not None else K(IntSort(), z)
        self.rewards_arr = rewards_arr if rewards_arr is not None else K(IntSort(), z)
        self.totalStaked = totalStaked if totalStaked is not None else z
        self.sumStaked = sumStaked if sumStaked is not None else z
        self.rewardPool = rewardPool if rewardPool is not None else z
        self.sumRewards = sumRewards if sumRewards is not None else z
        self.cross_in_progress = cross_in_progress if cross_in_progress is not None else z
        self.cross_snapshot_total = cross_snapshot_total if cross_snapshot_total is not None else z
        self.cross_snapshot_sum_bal = cross_snapshot_sum_bal if cross_snapshot_sum_bal is not None else z
        self.price = price if price is not None else z
        self.twap_age = twap_age if twap_age is not None else z
        self.timelock_time = timelock_time if timelock_time is not None else z


# ── Guard application ───────────────────────────────────────────────────

def _apply_guards(guard_names, s, actor, to, src, owner, amt,
                  func_id=0, dy=None, pool_addr=None):
    conds = []
    for g in guard_names:
        g = g.strip()
        if g == "amt_gt_0":           conds.append(amt > 0)
        elif g == "bal_ge_amt":        conds.append(Select(s.bal, actor) >= amt)
        elif g == "bal_gt_0":          conds.append(Select(s.bal, actor) > 0)
        elif g == "total_ge_amt":      conds.append(s.total >= amt)
        elif g == "sender_is_owner":   conds.append(actor == owner)
        elif g == "bal_src_ge_amt":    conds.append(Select(s.bal, src) >= amt)
        elif g == "allowance_ge_amt":  conds.append(Select(s.allow, src) >= amt)
        elif g == "shares_ge_amt":     conds.append(Select(s.shr, actor) >= amt)
        elif g == "total_shares_ge_amt": conds.append(s.total_shares >= amt)
        elif g == "not_locked":        conds.append(Select(s.locks, func_id) == 0)
        elif g == "balance_unchanged_before_call":
            conds.append(s.snapshot_sum_bal == s.sum_bal)
        elif g == "dx_gt_0":           conds.append(amt > 0)
        elif g == "dy_gt_0":
            if dy is None:
                raise ValueError("guard dy_gt_0 requires a dy parameter")
            conds.append(dy > 0)
        elif g == "reserveX_ge_dx":    conds.append(s.reserveX >= amt)
        elif g == "reserveY_ge_dy":
            if dy is None:
                raise ValueError("guard reserveY_ge_dy requires a dy parameter")
            conds.append(s.reserveY >= dy)
        elif g == "lp_ge_amt":         conds.append(Select(s.lpBal, actor) >= amt)
        elif g == "collateral_ge_amt": conds.append(Select(s.collateral, actor) >= amt)
        elif g == "debt_ge_amt":       conds.append(Select(s.debt_arr, actor) >= amt)
        elif g == "healthy_position":
            conds.append(Select(s.collateral, actor) * s.liqThreshold
                         >= Select(s.debt_arr, actor) * BPB)
        elif g == "staked_ge_amt":     conds.append(Select(s.staked, actor) >= amt)
        elif g == "rewards_ge_amt":    conds.append(Select(s.rewards_arr, actor) >= amt)
        elif g == "cross_not_in_progress":
            conds.append(s.cross_in_progress == 0)
        elif g == "cross_snapshot_match":
            conds.append(And(s.cross_snapshot_total == s.total,
                             s.cross_snapshot_sum_bal == s.sum_bal))
        elif g == "price_ge_min":      conds.append(s.price >= amt)
        elif g == "price_valid":       conds.append(s.price > 0)
        elif g == "twap_stale":        conds.append(s.twap_age < amt)
        elif g == "timelock_expired":  conds.append(s.timelock_time <= 0)
        else:
            raise ValueError(f"unknown guard: {g}")
    return conds


# ── Effect application ──────────────────────────────────────────────────

def _apply_effects(effect_names, s, actor, to, src, amt,
                   func_id=0, dy=None):
    total, total_shares = s.total, s.total_shares
    bal, shr, allow = s.bal, s.shr, s.allow
    sum_bal, sum_shr = s.sum_bal, s.sum_shr
    locks, in_call = s.locks, s.in_call
    snap_t, snap_b = s.snapshot_total, s.snapshot_sum_bal
    reserveX, reserveY = s.reserveX, s.reserveY
    lpSupply, lpBal, sumLpBal, initialK = s.lpSupply, s.lpBal, s.sumLpBal, s.initialK
    collateral, debt_arr = s.collateral, s.debt_arr
    totalCollateral, totalDebt = s.totalCollateral, s.totalDebt
    sumCollateral, sumDebt = s.sumCollateral, s.sumDebt
    liqThreshold = s.liqThreshold
    staked, rewards_arr = s.staked, s.rewards_arr
    totalSt, sumSt = s.totalStaked, s.sumStaked
    rewardPool, sumRewards = s.rewardPool, s.sumRewards
    cross_ip = s.cross_in_progress
    cross_st, cross_sb = s.cross_snapshot_total, s.cross_snapshot_sum_bal
    price, twap_age = s.price, s.twap_age
    timelock_time = s.timelock_time

    for e in effect_names:
        e = e.strip()
        if e == "bal_add_amt":
            bal = Store(bal, actor, Select(bal, actor) + amt)
            sum_bal = sum_bal + amt
        elif e == "bal_sub_amt":
            bal = Store(bal, actor, Select(bal, actor) - amt)
            sum_bal = sum_bal - amt
        elif e == "bal_add_amt_to":
            bal = Store(bal, to, Select(bal, to) + amt)
            sum_bal = sum_bal + amt
        elif e == "bal_sub_amt_src":
            bal = Store(bal, src, Select(bal, src) - amt)
            sum_bal = sum_bal - amt
        elif e == "set_bal_zero":
            sum_bal = sum_bal - Select(bal, actor)
            bal = Store(bal, actor, IntVal(0))
        elif e == "total_add_amt":
            total = total + amt
        elif e == "total_sub_amt":
            total = total - amt
        elif e == "shares_add_amt":
            shr = Store(shr, actor, Select(shr, actor) + amt)
            sum_shr = sum_shr + amt
        elif e == "shares_sub_amt":
            shr = Store(shr, actor, Select(shr, actor) - amt)
            sum_shr = sum_shr - amt
        elif e == "total_shares_add_amt":
            total_shares = total_shares + amt
        elif e == "total_shares_sub_amt":
            total_shares = total_shares - amt
        elif e == "allowance_sub_amt":
            allow = Store(allow, src, Select(allow, src) - amt)
        elif e == "allowance_set_zero":
            allow = Store(allow, src, IntVal(0))
        elif e == "reentrancy_lock_acquire":
            locks = Store(locks, func_id, IntVal(1))
        elif e == "reentrancy_lock_release":
            locks = Store(locks, func_id, IntVal(0))
            in_call = IntVal(0)
        elif e == "external_call":
            snap_t = total; snap_b = sum_bal; in_call = IntVal(1)
        elif e == "reserveX_add":
            reserveX = reserveX + amt
        elif e == "reserveX_sub":
            reserveX = reserveX - amt
        elif e == "reserveY_add":
            reserveY = reserveY + (dy if dy is not None else amt)
        elif e == "reserveY_sub":
            reserveY = reserveY - (dy if dy is not None else amt)
        elif e == "lp_mint_amt":
            lpSupply = lpSupply + amt
            lpBal = Store(lpBal, actor, Select(lpBal, actor) + amt)
            sumLpBal = sumLpBal + amt
        elif e == "lp_burn_amt":
            lpSupply = lpSupply - amt
            lpBal = Store(lpBal, actor, Select(lpBal, actor) - amt)
            sumLpBal = sumLpBal - amt
        elif e == "lp_add_amt_to":
            lpBal = Store(lpBal, to, Select(lpBal, to) + amt)
            sumLpBal = sumLpBal + amt
        elif e == "lp_sub_amt_src":
            lpBal = Store(lpBal, src, Select(lpBal, src) - amt)
            sumLpBal = sumLpBal - amt
        elif e == "collateral_add":
            collateral = Store(collateral, actor, Select(collateral, actor) + amt)
            totalCollateral = totalCollateral + amt
            sumCollateral = sumCollateral + amt
        elif e == "collateral_sub":
            collateral = Store(collateral, actor, Select(collateral, actor) - amt)
            totalCollateral = totalCollateral - amt
            sumCollateral = sumCollateral - amt
        elif e == "debt_add":
            debt_arr = Store(debt_arr, actor, Select(debt_arr, actor) + amt)
            totalDebt = totalDebt + amt
            sumDebt = sumDebt + amt
        elif e == "debt_sub":
            debt_arr = Store(debt_arr, actor, Select(debt_arr, actor) - amt)
            totalDebt = totalDebt - amt
            sumDebt = sumDebt - amt
        elif e == "total_collateral_add":
            totalCollateral = totalCollateral + amt
        elif e == "total_collateral_sub":
            totalCollateral = totalCollateral - amt
        elif e == "total_debt_add":
            totalDebt = totalDebt + amt
        elif e == "total_debt_sub":
            totalDebt = totalDebt - amt
        elif e == "stake_add":
            staked = Store(staked, actor, Select(staked, actor) + amt)
            totalSt = totalSt + amt
            sumSt = sumSt + amt
        elif e == "stake_sub":
            staked = Store(staked, actor, Select(staked, actor) - amt)
            totalSt = totalSt - amt
            sumSt = sumSt - amt
        elif e == "reward_mint":
            rewardPool = rewardPool + amt
            sumRewards = sumRewards + amt
        elif e == "reward_claim":
            rewards_arr = Store(rewards_arr, actor, Select(rewards_arr, actor) - amt)
            sumRewards = sumRewards - amt
        elif e == "total_staked_add":
            totalSt = totalSt + amt
        elif e == "total_staked_sub":
            totalSt = totalSt - amt
        elif e == "cross_contract_call":
            cross_st = total; cross_sb = sum_bal
            cross_ip = IntVal(1)
        elif e == "cross_contract_return":
            cross_ip = IntVal(0)
        elif e == "price_update":
            price = amt
            twap_age = IntVal(0)
        elif e == "oracle_manipulate":
            price = amt
            twap_age = twap_age + 1
        elif e == "proposal_execute":
            timelock_time = amt
        else:
            raise ValueError(f"unknown effect: {e}")

    return State(total, total_shares, bal, shr, allow, sum_bal, sum_shr,
                 locks=locks, in_call=in_call,
                 snapshot_total=snap_t, snapshot_sum_bal=snap_b,
                 reserveX=reserveX, reserveY=reserveY,
                 lpSupply=lpSupply, lpBal=lpBal,
                 sumLpBal=sumLpBal, initialK=initialK,
                 collateral=collateral, debt=debt_arr,
                 totalCollateral=totalCollateral, totalDebt=totalDebt,
                 sumCollateral=sumCollateral, sumDebt=sumDebt,
                 liqThreshold=liqThreshold,
                 staked=staked, rewards_arr=rewards_arr,
                 totalStaked=totalSt, sumStaked=sumSt,
                 rewardPool=rewardPool, sumRewards=sumRewards,
                  cross_in_progress=cross_ip,
                  cross_snapshot_total=cross_st,
                  cross_snapshot_sum_bal=cross_sb,
                  price=price, twap_age=twap_age,
                  timelock_time=timelock_time)


# ── Invariant hypotheses (pre-state) ────────────────────────────────────

def _hypothesis(name, s):
    u = Int("u")
    if name == "nonneg_balance":
        return ForAll([u], Select(s.bal, u) >= 0)
    if name == "nonneg_shares":
        return ForAll([u], Select(s.shr, u) >= 0)
    if name == "nonneg_allowance":
        return ForAll([u], Select(s.allow, u) >= 0)
    if name == "nonneg_total":
        return s.total >= 0
    if name == "nonneg_total_shares":
        return s.total_shares >= 0
    if name == "solvency":
        return s.sum_bal == s.total
    if name == "shares_integrity":
        return s.sum_shr == s.total_shares
    if name == "backing":
        return s.total >= s.total_shares
    if name == "supply_cap":
        return s.total <= CAP
    if name == "reentrancy_safe":
        return Implies(s.in_call != 0,
                       And(s.total == s.snapshot_total,
                           s.sum_bal == s.snapshot_sum_bal))
    if name == "nonneg_reserves":
        return And(s.reserveX >= 0, s.reserveY >= 0)
    if name == "nonneg_lp":
        return ForAll([u], Select(s.lpBal, u) >= 0)
    if name == "constant_product":
        return Implies(s.initialK > 0,
                       s.reserveX * s.reserveY >= s.initialK)
    if name == "lp_integrity":
        return s.sumLpBal == s.lpSupply
    if name == "backing_amm":
        return s.lpSupply >= 0
    if name == "nonneg_collateral":
        return ForAll([u], Select(s.collateral, u) >= 0)
    if name == "nonneg_debt":
        return ForAll([u], Select(s.debt_arr, u) >= 0)
    if name == "nonneg_total_collateral":
        return s.totalCollateral >= 0
    if name == "nonneg_total_debt":
        return s.totalDebt >= 0
    if name == "collateral_integrity":
        return s.sumCollateral == s.totalCollateral
    if name == "debt_integrity":
        return s.sumDebt == s.totalDebt
    if name == "overcollateralized":
        return Implies(s.totalDebt > 0,
                       s.totalCollateral * s.liqThreshold >= s.totalDebt * BPB)
    if name == "lending_solvency":
        return s.totalCollateral >= s.totalDebt
    if name == "nonneg_staked":
        return ForAll([u], Select(s.staked, u) >= 0)
    if name == "nonneg_rewards":
        return ForAll([u], Select(s.rewards_arr, u) >= 0)
    if name == "stake_integrity":
        return s.sumStaked == s.totalStaked
    if name == "reward_integrity":
        return s.sumRewards <= s.rewardPool
    if name == "staking_backing":
        return s.rewardPool >= 0
    if name == "cross_contract_safe":
        return Implies(s.cross_in_progress != 0,
                       And(s.total == s.cross_snapshot_total,
                           s.sum_bal == s.cross_snapshot_sum_bal))
    if name == "nonneg_price":
        return s.price >= 0
    if name == "price_stability":
        return s.price <= CAP
    if name == "oracle_integrity":
        return Implies(s.price > 0, s.twap_age == 0)
    if name == "nonneg_timelock":
        return s.timelock_time >= 0
    raise ValueError(f"unknown invariant: {name}")


# ── Invariant goals (post-state) ────────────────────────────────────────

def _goal(name, s, touched, model="erc20_pool"):
    if name == "nonneg_balance":
        return And([Select(s.bal, i) >= 0 for i in touched])
    if name == "nonneg_shares":
        return And([Select(s.shr, i) >= 0 for i in touched])
    if name == "nonneg_allowance":
        return And([Select(s.allow, i) >= 0 for i in touched])
    if name == "nonneg_lp":
        return And([Select(s.lpBal, i) >= 0 for i in touched])
    if name == "nonneg_collateral":
        return And([Select(s.collateral, i) >= 0 for i in touched])
    if name == "nonneg_debt":
        return And([Select(s.debt_arr, i) >= 0 for i in touched])
    if name == "nonneg_staked":
        return And([Select(s.staked, i) >= 0 for i in touched])
    if name == "nonneg_rewards":
        return And([Select(s.rewards_arr, i) >= 0 for i in touched])
    if name == "nonneg_price":
        return s.price >= 0
    if name == "price_stability":
        return s.price <= CAP
    if name == "oracle_integrity":
        return Implies(s.price > 0, s.twap_age == 0)
    if name == "nonneg_timelock":
        return s.timelock_time >= 0
    return _hypothesis(name, s)


# ── Inductive verification engine ───────────────────────────────────────

def _build_pre_state(model):
    return State(
        Int("totalAssets_pre"), Int("totalShares_pre"),
        Array("balances_pre", IntSort(), IntSort()),
        Array("shares_pre", IntSort(), IntSort()),
        Array("allowances_pre", IntSort(), IntSort()),
        Int("sumBalances_pre"), Int("sumShares_pre"),
        locks=Array("locks_pre", IntSort(), IntSort()),
        in_call=Int("in_call_pre"),
        snapshot_total=Int("snapshot_total_pre"),
        snapshot_sum_bal=Int("snapshot_sum_bal_pre"),
        reserveX=Int("reserveX_pre"), reserveY=Int("reserveY_pre"),
        lpSupply=Int("lpSupply_pre"),
        lpBal=Array("lpBal_pre", IntSort(), IntSort()),
        sumLpBal=Int("sumLpBal_pre"), initialK=Int("initialK_pre"),
        collateral=Array("collateral_pre", IntSort(), IntSort()),
        debt=Array("debt_pre", IntSort(), IntSort()),
        totalCollateral=Int("totalCollateral_pre"), totalDebt=Int("totalDebt_pre"),
        sumCollateral=Int("sumCollateral_pre"), sumDebt=Int("sumDebt_pre"),
        liqThreshold=Int("liqThreshold_pre"),
        staked=Array("staked_pre", IntSort(), IntSort()),
        rewards_arr=Array("rewards_pre", IntSort(), IntSort()),
        totalStaked=Int("totalStaked_pre"), sumStaked=Int("sumStaked_pre"),
        rewardPool=Int("rewardPool_pre"), sumRewards=Int("sumRewards_pre"),
        cross_in_progress=Int("cross_in_progress_pre"),
        cross_snapshot_total=Int("cross_snapshot_total_pre"),
        cross_snapshot_sum_bal=Int("cross_snapshot_sum_bal_pre"),
        price=Int("price_pre"), twap_age=Int("twap_age_pre"),
        timelock_time=Int("timelock_time_pre"),
    )


def _build_base_axioms(pre, invariants, touched, model):
    base = []
    for hyp in invariants:
        base.append(_hypothesis(hyp, pre))
    u = Int("u")
    base.append(Implies(ForAll([u], Select(pre.bal, u) >= 0),
                        And([Select(pre.bal, i) <= pre.sum_bal for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.shr, u) >= 0),
                        And([Select(pre.shr, i) <= pre.sum_shr for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.lpBal, u) >= 0),
                        And([Select(pre.lpBal, i) <= pre.sumLpBal for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.collateral, u) >= 0),
                        And([Select(pre.collateral, i) <= pre.sumCollateral for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.debt_arr, u) >= 0),
                        And([Select(pre.debt_arr, i) <= pre.sumDebt for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.staked, u) >= 0),
                        And([Select(pre.staked, i) <= pre.sumStaked for i in touched])))
    base.append(Implies(ForAll([u], Select(pre.rewards_arr, u) >= 0),
                        And([Select(pre.rewards_arr, i) <= pre.sumRewards for i in touched])))
    if model == "amm_pool":
        base.append(pre.initialK > 0)
    if model == "lending_pool":
        base.append(pre.liqThreshold > 0)
        base.append(pre.liqThreshold <= IntVal(BPB))
    return base


def check_function(func, invariants, model="erc20_pool"):
    results = []
    func_id_val = IntVal(func.get("func_id", 0))
    for inv in invariants:
        actor, to, src, owner = Int("actor"), Int("to"), Int("src"), Int("owner")
        amt, dy = Int("amt"), Int("dy")
        pre = _build_pre_state(model)
        touched = [actor, to, src]

        base = [actor >= 0, to >= 0, src >= 0, owner >= 0]
        base.extend(_build_base_axioms(pre, invariants, touched, model))

        guards = _apply_guards(func["guards"], pre, actor, to, src, owner, amt,
                               func_id_val, dy=dy)
        post = _apply_effects(func["effects"], pre, actor, to, src, amt,
                              func_id_val, dy=dy)

        s = Solver()
        s.add(base)
        s.add(guards)
        s.add(Not(_goal(inv, post, touched, model)))

        res = s.check()
        if res == unsat:
            results.append({"invariant": inv, "status": "proved", "counterexample": None})
        elif res == sat:
            m = s.model()
            ev = lambda t: str(m.eval(t, model_completion=True))
            cex = {
                "actor": ev(actor), "to": ev(to), "src": ev(src), "amt": ev(amt),
                "dy": ev(dy) if dy is not None else "0",
                "totalAssets_pre": ev(pre.total), "totalAssets_post": ev(post.total),
                "totalShares_pre": ev(pre.total_shares), "totalShares_post": ev(post.total_shares),
                "balance_actor_pre": ev(Select(pre.bal, actor)),
                "balance_actor_post": ev(Select(post.bal, actor)),
                "balance_to_post": ev(Select(post.bal, to)),
                "balance_src_post": ev(Select(post.bal, src)),
                "shares_actor_pre": ev(Select(pre.shr, actor)),
                "shares_actor_post": ev(Select(post.shr, actor)),
                "allowance_src_pre": ev(Select(pre.allow, src)),
                "allowance_src_post": ev(Select(post.allow, src)),
                "reserveX_pre": ev(pre.reserveX), "reserveX_post": ev(post.reserveX),
                "reserveY_pre": ev(pre.reserveY), "reserveY_post": ev(post.reserveY),
                "lpSupply_pre": ev(pre.lpSupply), "lpSupply_post": ev(post.lpSupply),
                "collateral_actor_pre": ev(Select(pre.collateral, actor)),
                "collateral_actor_post": ev(Select(post.collateral, actor)),
                "debt_actor_pre": ev(Select(pre.debt_arr, actor)),
                "debt_actor_post": ev(Select(post.debt_arr, actor)),
                "totalCollateral_pre": ev(pre.totalCollateral),
                "totalCollateral_post": ev(post.totalCollateral),
                "totalDebt_pre": ev(pre.totalDebt), "totalDebt_post": ev(post.totalDebt),
                "staked_actor_pre": ev(Select(pre.staked, actor)),
                "staked_actor_post": ev(Select(post.staked, actor)),
                "rewards_actor_pre": ev(Select(pre.rewards_arr, actor)),
                "rewards_actor_post": ev(Select(post.rewards_arr, actor)),
            }
            results.append({"invariant": inv, "status": "violated", "counterexample": cex})
        else:
            results.append({"invariant": inv, "status": "unknown", "counterexample": None})
    return results


def check_vacuity(func, invariants, model="erc20_pool"):
    """Return True if the function's guards are unsatisfiable under the base
    axioms (i.e., all its proofs would be vacuous)."""
    actor, to, src, owner = Int("actor"), Int("to"), Int("src"), Int("owner")
    amt, dy = Int("amt"), Int("dy")
    pre = _build_pre_state(model)
    touched = [actor, to, src]
    base = [actor >= 0, to >= 0, src >= 0, owner >= 0]
    base.extend(_build_base_axioms(pre, invariants, touched, model))
    func_id_val = IntVal(func.get("func_id", 0))
    guards = _apply_guards(func["guards"], pre, actor, to, src, owner, amt,
                           func_id_val, dy=dy)
    s = Solver()
    s.add(base)
    s.add(guards)
    return s.check() == unsat
