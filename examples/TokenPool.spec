/// CVL specification generated from Counterflow binding
/// Model: erc20_pool
/// Generated: 2026-07-21T17:47:11.910Z
/// Source: Counterflow v0.3.0 — https://github.com/KryptosAI/counterflow

// ---- ghost variable declarations ----
ghost mathint ghost_sumBalances { init_state assert ghost_sumBalances == 0; }
ghost mathint ghost_sumTotal { init_state assert ghost_sumTotal == 0; }

// ---- function transition rules ----

    /// @notice Counterflow rule for function: deposit
    rule deposit(method f) {
        env e;
        calldataarg args;

        // ---- pre-conditions (guards) ----
        require amt > 0;

        f(e, args);

        // ---- post-conditions (effects) ----
        ghost_sumBalances = ghost_sumBalances + amt;
        ghost_sumTotal = ghost_sumTotal + amt;
    }

    /// @notice Counterflow rule for function: withdraw
    rule withdraw(method f) {
        env e;
        calldataarg args;

        // ---- pre-conditions (guards) ----
        require amt > 0;
        require balances[e.msg.sender] >= amt;

        f(e, args);

        // ---- post-conditions (effects) ----
        ghost_sumBalances = ghost_sumBalances - amt;
        ghost_sumTotal = ghost_sumTotal - amt;
    }

// ---- invariant rules ----

    /// @notice Invariant: balances never negative
    invariant nonneg_balance(method f)
        filtered { f -> true }
    {
        preserve {
            satisfy ghost_sumBalances >= 0;
        }
    }

    /// @notice Invariant: total assets never negative
    invariant nonneg_total(method f)
        filtered { f -> true }
    {
        preserve {
            satisfy ghost_sumTotal >= 0;
        }
    }

    /// @notice Invariant: sum of balances equals total assets
    invariant solvency(method f)
        filtered { f -> true }
    {
        preserve {
            satisfy ghost_sumBalances == ghost_sumTotal;
        }
    }

