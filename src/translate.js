const { callLLM, extractJSON } = require('./llm');

const GUARDS = [
  'amt_gt_0', 'bal_ge_amt', 'bal_gt_0', 'total_ge_amt', 'sender_is_owner',
  'bal_src_ge_amt', 'allowance_ge_amt', 'shares_ge_amt', 'total_shares_ge_amt',
  'not_locked', 'balance_unchanged_before_call',
  'dx_gt_0', 'dy_gt_0', 'reserveX_ge_dx', 'reserveY_ge_dy', 'lp_ge_amt',
  'collateral_ge_amt', 'debt_ge_amt', 'healthy_position',
  'staked_ge_amt', 'rewards_ge_amt',
  'cross_not_in_progress', 'cross_snapshot_match',
  'price_ge_min', 'price_valid', 'twap_stale',
  'timelock_expired',
];
const EFFECTS = [
  'bal_add_amt', 'bal_sub_amt', 'bal_add_amt_to', 'bal_sub_amt_src', 'set_bal_zero',
  'total_add_amt', 'total_sub_amt',
  'shares_add_amt', 'shares_sub_amt', 'total_shares_add_amt', 'total_shares_sub_amt',
  'allowance_sub_amt', 'allowance_set_zero',
  'reentrancy_lock_acquire', 'reentrancy_lock_release', 'external_call',
  'reserveX_add', 'reserveX_sub', 'reserveY_add', 'reserveY_sub',
  'lp_mint_amt', 'lp_burn_amt', 'lp_add_amt_to', 'lp_sub_amt_src',
  'collateral_add', 'collateral_sub', 'debt_add', 'debt_sub',
  'total_collateral_add', 'total_collateral_sub', 'total_debt_add', 'total_debt_sub',
  'stake_add', 'stake_sub', 'reward_mint', 'reward_claim',
  'total_staked_add', 'total_staked_sub',
  'cross_contract_call', 'cross_contract_return',
  'price_update', 'oracle_manipulate',
  'proposal_execute',
];
const INVARIANTS = [
  'nonneg_balance', 'nonneg_shares', 'nonneg_allowance',
  'nonneg_total', 'nonneg_total_shares',
  'solvency', 'shares_integrity', 'backing', 'supply_cap',
  'reentrancy_safe',
  'nonneg_reserves', 'nonneg_lp', 'constant_product', 'lp_integrity', 'backing_amm',
  'nonneg_collateral', 'nonneg_debt', 'nonneg_total_collateral', 'nonneg_total_debt',
  'collateral_integrity', 'debt_integrity', 'overcollateralized', 'lending_solvency',
  'nonneg_staked', 'nonneg_rewards', 'stake_integrity', 'reward_integrity', 'staking_backing',
  'cross_contract_safe',
  'nonneg_price', 'price_stability', 'oracle_integrity',
  'nonneg_timelock',
];

const SYSTEM_PROMPT = `You are a formal-methods abstraction engine for smart contracts.
You DO NOT decide whether a contract is safe. You ONLY translate a Solidity
contract and English safety properties into a structured abstraction ("binding")
drawn strictly from the fixed vocabularies below. A sound Z3 solver checks the
result, so your only job is a faithful, conservative translation.

State model: a generic ERC20-style pool / ERC4626-style vault.
  totalAssets        : pool-wide asset total
  totalShares        : vault share supply
  balances[a]        : per-address token claim
  shares[a]          : per-address vault shares
  allowances[src]    : allowance granted by src to msg.sender
  actor = msg.sender, to = recipient param, src = transferFrom source param
  amt = the call amount

GUARDS (require-statements the function actually enforces — include ONLY those present in the code):
  amt_gt_0            -> require(amt > 0)
  bal_ge_amt          -> require(balances[msg.sender] >= amt)
  bal_gt_0            -> require(balances[msg.sender] > 0)
  total_ge_amt        -> require(totalAssets >= amt)
  sender_is_owner     -> require(msg.sender == owner)
  bal_src_ge_amt      -> require(balances[src] >= amt)
  allowance_ge_amt    -> require(allowances[src][msg.sender] >= amt)
  shares_ge_amt       -> require(shares[msg.sender] >= amt)
  total_shares_ge_amt -> require(totalShares >= amt)
  not_locked          -> require(!locked) — the function's reentrancy lock is free

EFFECTS (state mutations the function performs, in order):
  bal_add_amt           -> balances[msg.sender] += amt
  bal_sub_amt           -> balances[msg.sender] -= amt
  bal_add_amt_to        -> balances[to] += amt
  bal_sub_amt_src       -> balances[src] -= amt
  set_bal_zero          -> balances[msg.sender] = 0
  total_add_amt         -> totalAssets += amt
  total_sub_amt         -> totalAssets -= amt
  shares_add_amt        -> shares[msg.sender] += amt
  shares_sub_amt        -> shares[msg.sender] -= amt
  total_shares_add_amt  -> totalShares += amt
  total_shares_sub_amt  -> totalShares -= amt
  allowance_sub_amt     -> allowances[src][msg.sender] -= amt
  allowance_set_zero    -> allowances[src][msg.sender] = 0
  reentrancy_lock_acquire -> sets a ghost Boolean locked_{func} to true on function entry (implicit for any function that uses not_locked guard)
  reentrancy_lock_release -> sets locked_{func} to false on function exit
  external_call          -> marks a point where the contract makes an external call (transfer, call, etc.); the reentrancy_safe invariant is checked at this boundary

INVARIANTS (map each English property to exactly one):
  nonneg_balance      -> a user's balance can never go negative
  nonneg_shares       -> a user's share count can never go negative
  nonneg_allowance    -> an allowance can never go negative (spender cannot exceed approval)
  nonneg_total        -> the pool asset total can never go negative
  nonneg_total_shares -> the share supply can never go negative
  solvency            -> accounting integrity: user balances always sum to totalAssets
                         (with nonneg_balance, implies no user can claim more than the pool holds)
  shares_integrity    -> user shares always sum to totalShares
  backing             -> every share is asset-backed: totalAssets >= totalShares
  supply_cap          -> totalAssets never exceeds the fixed cap
  reentrancy_safe     -> the contract cannot re-enter itself: at most one function lock is held at a time, and storage equals its snapshot at the last external call

CRITICAL RULES:
- Only list a guard if the require/check is ACTUALLY present in the code. If a
  balance/allowance check is missing, DO NOT invent it — the whole point is to catch that.
- Unchecked arithmetic (an \`unchecked { }\` block) provides NO implicit guard.
- Solidity >=0.8 checked arithmetic on a SUBTRACTION acts as an implicit guard
  (underflow reverts): model \`x -= amt\` OUTSIDE an unchecked block as if guarded
  by the corresponding *_ge_amt guard. Inside unchecked blocks, no guard.
- Output ONLY JSON, no prose.
- If a function makes an external call (transfer, call, delegatecall), include \`external_call\` effect at that point.
- If a function uses a reentrancy guard modifier like nonReentrant, model it with \`not_locked\` guard and \`reentrancy_lock_acquire\`/\`reentrancy_lock_release\` effects.

Output schema:
{
  "model": "erc20_pool",
  "functions": [
    {"name": "<solidity function name>", "guards": [...], "effects": [...]}
  ],
  "invariants": [...],
  "invariant_mapping": [
    {"english": "<original English property>", "invariant": "<invariant id>"}
  ]
}`;

async function translate(soliditySource, englishInvariants) {
  const userPrompt = `SOLIDITY CONTRACT:\n\`\`\`solidity\n${soliditySource}\n\`\`\`\n\nENGLISH SAFETY PROPERTIES:\n${englishInvariants}\n\nProduce the binding JSON.`;
  const res = await callLLM(SYSTEM_PROMPT, userPrompt);
  if (!res || !res.content) {
    return { binding: null, error: 'LLM unavailable or returned no content', usage: res };
  }
  const binding = extractJSON(res.content);
  if (!binding) {
    return { binding: null, error: 'Failed to parse binding JSON from LLM output', raw: res.content, usage: res };
  }
  return {
    binding,
    usage: {
      provider: res.provider,
      model: res.model,
      inputTokens: res.inputTokens,
      outputTokens: res.outputTokens,
    },
  };
}

module.exports = { translate, SYSTEM_PROMPT, GUARDS, EFFECTS, INVARIANTS };
