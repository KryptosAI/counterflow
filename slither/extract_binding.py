#!/usr/bin/env python3
"""
Slither plugin that extracts guards and effects from a Solidity contract
and emits a binding-compatible JSON vocabulary on stdout.

Usage:
    python extract_binding.py <Contract.sol>

    import extract_binding
    result = extract_binding.extract_binding("path/to/Contract.sol")
"""

import json
import re
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# Graceful slither import
# ---------------------------------------------------------------------------
SLITHER_AVAILABLE = True
try:
    from slither import Slither
except ImportError:
    SLITHER_AVAILABLE = False


# ---------------------------------------------------------------------------
# Helper – balanced-paren extraction
# ---------------------------------------------------------------------------
def _extract_balanced_parens(text, open_pos):
    """
    Extract content inside balanced parentheses.
    *open_pos* is the index of '('.
    Returns the text between '(' and the matching ')' or None.
    """
    if open_pos >= len(text) or text[open_pos] != '(':
        return None
    depth = 1
    start = open_pos + 1
    for i in range(start, len(text)):
        ch = text[i]
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
            if depth == 0:
                return text[start:i]
    return None


def _find_matching_brace(text, open_pos):
    """
    Extract content inside balanced braces  { … } .
    *open_pos* is the index of '{'.
    Returns (content, index_of_closing_brace) or (None, -1).
    """
    if open_pos >= len(text) or text[open_pos] != '{':
        return None, -1
    depth = 1
    start = open_pos + 1
    for i in range(start, len(text)):
        ch = text[i]
        if ch == '{':
            depth += 1
        elif ch == '}':
            depth -= 1
            if depth == 0:
                return text[start:i], i
    return None, -1


def _normalize_condition(text):
    """Collapse whitespace, remove comments, trim."""
    # remove single-line comments
    text = re.sub(r'//[^\n]*', '', text)
    # remove block comments
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)
    # collapse whitespace
    text = ' '.join(text.split())
    return text.strip()


def _strip_type_cast(text):
    """
    Remove Solidity type casts like uint256(…), address(…), etc.
    so that pattern matching sees the inner expression.
    """
    type_pattern = (
        r'^(?:uint(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|'
        r'152|160|168|176|184|192|200|208|216|224|232|240|248|256)'
        r'|int(?:8|16|24|32|40|48|56|64|72|80|88|96|104|112|120|128|136|144|'
        r'152|160|168|176|184|192|200|208|216|224|232|240|248|256)'
        r'|address|bool|bytes\d*)\s*\(\s*(.+?)\s*\)$'
    )
    while True:
        m = re.match(type_pattern, text)
        if not m:
            break
        text = m.group(1).strip()
    return text


# ---------------------------------------------------------------------------
# Parameter classification
# ---------------------------------------------------------------------------
_AMOUNT_NAMES = {
    'amt', 'amount', 'value', 'deposit', 'wad', 'shares', 'shareamount',
    '_amt', '_amount', '_value', '_deposit', '_wad', '_shares', 'additionaldeposit',
}
_DST_NAMES = {
    'to', 'dst', 'recipient', 'payee', 'receiver', 'beneficiary',
    '_to', '_dst', '_recipient', '_payee', '_receiver', '_beneficiary',
}
_SRC_NAMES = {
    'src', 'from', 'sender', 'payer', 'owner', 'account',
    '_src', '_from', '_sender', '_payer', '_owner', '_account',
}


def _classify_param_name(name):
    """Return 'amount' | 'destination' | 'source' | None."""
    low = name.lower()
    if low in _AMOUNT_NAMES:
        return 'amount'
    if low in _DST_NAMES:
        return 'destination'
    if low in _SRC_NAMES:
        return 'source'
    return None


# ---------------------------------------------------------------------------
# Guard pattern matching
# ---------------------------------------------------------------------------
def match_guard_pattern(condition):
    """
    Match a normalised require/assert/if condition to a canonical guard label.
    Returns label string or None.
    """
    c = _normalize_condition(condition)
    if not c:
        return None
    c = _strip_type_cast(c)

    # ── allowances[addr][msg.sender] >= var ──────────────────────────
    m = re.match(
        r'^(\w+)\s*\[\s*(\w+)\s*\]\s*\[\s*msg\.sender\s*\]\s*(>=|>)\s*(\w+)$',
        c,
    )
    if m:
        return 'allowance_ge_amt'

    # ── mapping[msg.sender] > 0 ──────────────────────────────────────
    m = re.match(r'^(\w+)\s*\[\s*msg\.sender\s*\]\s*>\s*0$', c)
    if m:
        return 'bal_gt_0'

    # ── mapping[msg.sender] >= var / shares[msg.sender] >= var ───────
    m = re.match(
        r'^(\w+)\s*\[\s*msg\.sender\s*\]\s*(>=|>)\s*(\w+)$', c
    )
    if m:
        map_name = m.group(1).lower()
        if 'share' in map_name:
            return 'shares_ge_amt'
        return 'bal_ge_amt'

    # ── mapping[addr] >= var  (src check) ────────────────────────────
    m = re.match(r'^(\w+)\s*\[\s*(\w+)\s*\]\s*(>=|>)\s*(\w+)$', c)
    if m:
        return 'bal_src_ge_amt'

    # ── msg.sender == var  or  var == msg.sender ─────────────────────
    m = re.match(r'^msg\.sender\s*==\s*(\w+)$', c)
    if m:
        return 'sender_is_owner'
    m = re.match(r'^(\w+)\s*==\s*msg\.sender$', c)
    if m:
        return 'sender_is_owner'

    # ── totalShares >= var / totalAssets >= var ───────────────────────
    m = re.match(r'^(\w+)\s*(>=|>)\s*(\w+)$', c)
    if m:
        left = m.group(1).lower()
        if 'totalshare' in left.replace('_', ''):
            return 'total_shares_ge_amt'
        if 'total' in left:
            return 'total_ge_amt'

    # ── var > 0 ──────────────────────────────────────────────────────
    m = re.match(r'^(\w+)\s*>\s*0$', c)
    if m:
        return 'amt_gt_0'

    # ── var != 0  (same semantics as > 0) ────────────────────────────
    m = re.match(r'^(\w+)\s*!=\s*0$', c)
    if m:
        return 'amt_gt_0'

    return None


# ---------------------------------------------------------------------------
# Effect pattern matching
# ---------------------------------------------------------------------------
def _classify_effect(var_name, lhs_key, op, rhs_value, param_map):
    """
    Classify a single recognised effect.

    Parameters
    ----------
    var_name : str   – name of the state variable (e.g. 'balances', 'totalAssets')
    lhs_key  : str | None – the index key for mappings (e.g. 'msg.sender'), or None
    op       : str   – '+=' | '-=' | '='
    rhs_value : str  – right-hand side expression (already stripped)
    param_map : dict – maps function param names -> 'amount'|'source'|'destination'
    """
    vn = var_name.lower().replace('_', '')
    rhs_zero = (rhs_value == '0')

    # ── shares mapping ───────────────────────────────────────────────
    if 'share' in vn and lhs_key is not None:
        if lhs_key == 'msg.sender':
            if op == '+=':
                return 'shares_add_amt'
            if op == '-=':
                return 'shares_sub_amt'
        return None

    # ── allowance mapping (double-index) ─────────────────────────────
    if 'allowance' in vn:
        if op == '-=':
            return 'allowance_sub_amt'
        if op == '=' and rhs_zero:
            return 'allowance_set_zero'
        # non-zero allowance set is not a defined effect label
        return None

    # ── totalShares scalar ───────────────────────────────────────────
    if 'totalshare' in vn and lhs_key is None:
        if op == '+=':
            return 'total_shares_add_amt'
        if op == '-=':
            return 'total_shares_sub_amt'
        return None

    # ── totalAssets / totalSupply / totalXxx scalar ──────────────────
    if 'total' in vn and lhs_key is None:
        if op == '+=':
            return 'total_add_amt'
        if op == '-=':
            return 'total_sub_amt'
        return None

    # ── balance mapping ──────────────────────────────────────────────
    if lhs_key is not None:
        if lhs_key == 'msg.sender':
            if op == '+=':
                return 'bal_add_amt'
            if op == '-=':
                return 'bal_sub_amt'
            if op == '=' and rhs_zero:
                return 'set_bal_zero'
        elif lhs_key in param_map:
            role = param_map[lhs_key]
            if op == '+=' and role == 'destination':
                return 'bal_add_amt_to'
            if op == '-=' and role == 'source':
                return 'bal_sub_amt_src'
            if op == '=' and rhs_zero:
                return 'set_bal_zero'
        else:
            # unknown key – guess based on operation
            if op == '+=':
                return 'bal_add_amt_to'
            if op == '-=':
                return 'bal_sub_amt_src'
            if op == '=' and rhs_zero:
                return 'set_bal_zero'

    return None


_EFFECT_REGEX = re.compile(
    r'(?P<var>\w+)\s*'
    r'(?:'
    r'\[(?P<key1>[^\]]+)\]\s*'
    r'(?:\[(?P<key2>[^\]]+)\]\s*)?'
    r')?'
    r'(?P<op>[\+\-\*\/&|^]?=)\s*'
    r'(?P<rhs>[^;]+)',
)


def extract_effects_from_source(func_source, state_var_names, param_map):
    """
    Scan *func_source* for assignment operations involving known
    *state_var_names* and map them to canonical effect labels.
    """
    effects = []
    unrecognized = []

    sv_set = set(state_var_names)

    for m in _EFFECT_REGEX.finditer(func_source):
        var = m.group('var')
        if var not in sv_set:
            continue

        key1 = m.group('key1')
        key2 = m.group('key2')
        op = m.group('op')
        rhs = m.group('rhs')

        if key1:
            key1 = key1.strip()
        if key2:
            key2 = key2.strip()

        # If there are two keys, treat as  [key1][key2]
        if key2:
            lhs_key = f"{key1}.{key2}"
        elif key1:
            lhs_key = key1
        else:
            lhs_key = None

        label = _classify_effect(var, lhs_key, op, rhs.strip(), param_map)
        if label:
            effects.append(label)
        else:
            unrecognized.append(f"{var}[{lhs_key or ''}] {op} {rhs.strip()}")

    return effects, unrecognized


# ---------------------------------------------------------------------------
# Guard extraction from source
# ---------------------------------------------------------------------------
def _negate_condition(cond):
    """Invert a boolean expression for if-revert -> require mapping."""
    c = cond.strip()
    # IMPORTANT: match multi-char operators before single-char to avoid
    #  <=  being caught by <  (and >= by >).
    # <=  →  >
    m = re.match(r'^(.+?)\s*<=\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} > {m.group(2).strip()}'
    # >=  →  <
    m = re.match(r'^(.+?)\s*>=\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} < {m.group(2).strip()}'
    # ==  →  !=
    m = re.match(r'^(.+?)\s*==\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} != {m.group(2).strip()}'
    # !=  →  ==
    m = re.match(r'^(.+?)\s*!=\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} == {m.group(2).strip()}'
    # >   →  <=
    m = re.match(r'^(.+?)\s*>\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} <= {m.group(2).strip()}'
    # <   →  >=
    m = re.match(r'^(.+?)\s*<\s*(.+)$', c)
    if m:
        return f'{m.group(1).strip()} >= {m.group(2).strip()}'
    # !x  →  x
    if c.startswith('!'):
        return c[1:].strip()
    # x   →  !x
    return f'!({c})'


def _split_first_arg(text):
    """
    Split at the first top-level comma (ignoring commas inside
    parenthesized sub-expressions and string literals).
    Returns (first_arg, rest_or_none).
    """
    depth = 0
    in_string = False
    quote_char = None
    for i, ch in enumerate(text):
        if in_string:
            if ch == quote_char and (i == 0 or text[i - 1] != '\\'):
                in_string = False
                quote_char = None
            continue
        if ch in ('"', "'"):
            in_string = True
            quote_char = ch
            continue
        if ch == '(':
            depth += 1
        elif ch == ')':
            depth -= 1
        elif ch == ',' and depth == 0:
            return text[:i].strip(), text[i + 1:].strip()
    return text.strip(), None


def _guard_conditions_from_source(source):
    """
    Yield (condition_text, from_revert) tuples for every guard-like
    expression found in *source*:  require(…) / assert(…) / if(…)revert

    *from_revert* is True when the condition comes from an if-revert
    pattern; the caller must negate it to match require/assert semantics.
    """
    # ── require( … )  &  assert( … ) ─────────────────────────────────
    for m in re.finditer(r'\b(require|assert)\s*\(', source):
        full = _extract_balanced_parens(source, m.end() - 1)
        if full:
            # require(condition, "message") – only keep the condition
            cond, _ = _split_first_arg(full)
            if cond:
                yield cond, False

    # ── if ( … ) revert … (single-line) ──────────────────────────────
    for m in re.finditer(r'\bif\s*\(', source):
        paren_open = m.end() - 1
        cond = _extract_balanced_parens(source, paren_open)
        if cond is None:
            continue

        close_paren = m.end() + len(cond)  # index of ')'
        after = source[close_paren + 1 : close_paren + 500].strip()

        # case:  ) revert …;
        if after.startswith('revert'):
            yield cond, True
            continue

        # case:  ) { … revert … }
        if after.startswith('{'):
            block, _cb = _find_matching_brace(after, 0)
            if block and 'revert' in block:
                # only treat as guard if the block does NOT start with
                # another if-revert (avoid false-positive outer guards)
                inner = block.strip()
                if not re.match(r'\bif\s*\(', inner):
                    yield cond, True
                # if the nested block starts with an if, that if will be
                # picked up on its own; skip the outer condition


def extract_guards_from_source(func_source):
    """
    Scan *func_source* for guard conditions and map them to canonical labels.
    Returns (labels, unrecognized_list).
    """
    guards = []
    unrecognized = []
    for cond, from_revert in _guard_conditions_from_source(func_source):
        # For if-revert patterns, negate the condition to get the
        # equivalent require/assert condition.
        if from_revert:
            cond = _negate_condition(cond)
        label = match_guard_pattern(cond)
        if label:
            guards.append(label)
        else:
            unrecognized.append(cond.strip())
    return guards, unrecognized


# ---------------------------------------------------------------------------
# Unchecked detection
# ---------------------------------------------------------------------------
def _find_unchecked_effects(func_source):
    """
    Return a list of effect descriptions inside ``unchecked { … }`` blocks.
    """
    unchecked_effects = []
    for m in re.finditer(r'\bunchecked\s*\{', func_source):
        block, _ = _find_matching_brace(func_source, m.end() - 1)
        if block:
            for sub in re.finditer(r'(\w+(?:\[[^\]]+\])*)\s*-=\s*([^;]+)', block):
                unchecked_effects.append(sub.group(0).strip())
    return unchecked_effects


# ---------------------------------------------------------------------------
# Confidence
# ---------------------------------------------------------------------------
def _confidence(total_recognized, unrecognized_count):
    if unrecognized_count == 0:
        return 'high'
    if unrecognized_count <= 2:
        return 'medium'
    return 'low'


# ---------------------------------------------------------------------------
# Main extraction
# ---------------------------------------------------------------------------
def extract_binding(filepath):
    """Core function – see module docstring."""
    if not SLITHER_AVAILABLE:
        sys.stderr.write(
            "slither not installed – pip install slither-analyzer\n"
        )
        sys.exit(1)

    try:
        slither = Slither(str(filepath))
    except Exception as exc:
        sys.stderr.write(f"slither analysis failed: {exc}\n")
        sys.exit(1)

    # pick a plausible model name from the compilation target
    target_path = Path(filepath).resolve()
    model = "erc20_pool"
    target_contracts = []
    for c in slither.contracts:
        # only consider contracts defined in the target file, not in
        # imported libraries whose source lives elsewhere
        c_path = Path(c.source_mapping.filename.absolute).resolve()
        if c_path == target_path:
            target_contracts.append(c)
            # first matching contract becomes the model name
            if model == "erc20_pool":
                c_low = c.name.lower()
                if c_low not in ('erc20', 'ierc20', 'ierc165', 'reentrancyguard',
                                 'safemath', 'ownable', 'context', 'address',
                                 'initializable'):
                    model = c.name

    if not target_contracts:
        sys.stderr.write(f"no contracts found in {filepath}\n")
        sys.exit(1)

    # grab source text once
    src_cache = {}
    for path, content in slither.source_code.items():
        src_cache[Path(path).resolve()] = content.split('\n')

    functions_out = []
    confidence = {}

    for contract in target_contracts:
        sv_names = {sv.name for sv in contract.state_variables}

        for func in contract.functions:
            if func.is_constructor or func.is_fallback:
                continue
            if func.name.startswith('slither'):
                continue
            if func.name.startswith('__'):
                continue
            # only process functions declared in *this* contract, not inherited
            declarer = getattr(func, 'contract_declarer', None)
            if declarer is not None and declarer != contract:
                continue

            # ── function source text ─────────────────────────────────
            sm = func.source_mapping
            abs_path = Path(sm.filename.absolute).resolve()
            lines = src_cache.get(abs_path)
            if not lines:
                continue

            func_lines = []
            for ln in sm.lines:
                if 1 <= ln <= len(lines):
                    func_lines.append(lines[ln - 1])
            if not func_lines:
                continue
            func_source = '\n'.join(func_lines)

            # ── parameter classification ─────────────────────────────
            param_map = {}
            for param in func.parameters:
                role = _classify_param_name(param.name)
                if role:
                    param_map[param.name] = role

            # ── guards ───────────────────────────────────────────────
            guards, unrecognized_g = extract_guards_from_source(func_source)

            # ── effects ──────────────────────────────────────────────
            effects, unrecognized_e = extract_effects_from_source(
                func_source, sv_names, param_map
            )

            # ── unchecked ────────────────────────────────────────────
            unchecked = _find_unchecked_effects(func_source)

            # ── assemble function entry ──────────────────────────────
            entry = {
                "name": func.name,
                "guards": list(dict.fromkeys(guards)),    # ordered, deduped
                "effects": list(dict.fromkeys(effects)),
            }
            if unchecked:
                entry["notes"] = [
                    f"unchecked block: {u}" for u in unchecked
                ]

            functions_out.append(entry)
            confidence[func.name] = _confidence(
                len(entry["guards"]) + len(entry["effects"]),
                len(unrecognized_g) + len(unrecognized_e),
            )

    return {
        "model": model,
        "functions": functions_out,
        "invariants": [],
        "extraction_confidence": confidence,
    }


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"usage: {sys.argv[0]} <Contract.sol> [--completeness <dummy>]", file=sys.stderr)
        sys.exit(1)
    result = extract_binding(sys.argv[1])

    # When --completeness is passed, also enumerate state variables
    do_completeness = '--completeness' in sys.argv
    if do_completeness:
        try:
            slither = Slither(str(sys.argv[1]))
            sv_list = []
            for contract in slither.contracts:
                for sv in contract.state_variables:
                    written_by = []
                    read_by = []
                    for func in contract.functions:
                        if func.is_constructor or func.is_fallback:
                            continue
                        if func.name.startswith('slither') or func.name.startswith('__'):
                            continue
                        sv_written = [v.name for v in func.state_variables_written]
                        sv_read = [v.name for v in func.state_variables_read]
                        if sv.name in sv_written:
                            written_by.append(func.name)
                        if sv.name in sv_read:
                            read_by.append(func.name)
                    info = {
                        "name": sv.name,
                        "type": str(sv.type),
                        "written_by": written_by,
                        "read_by": read_by,
                    }
                    name_lower = sv.name.lower()
                    if any(k in name_lower for k in ['balance', 'balances']):
                        info["classification"] = "balance"
                    elif any(k in name_lower for k in ['share', 'shares']):
                        info["classification"] = "share"
                    elif any(k in name_lower for k in ['allowance', 'allowances']):
                        info["classification"] = "allowance"
                    elif any(k in name_lower for k in ['total']):
                        info["classification"] = "total"
                    elif any(k in name_lower for k in ['lock', 'locked']):
                        info["classification"] = "lock"
                    elif any(k in name_lower for k in ['collateral', 'debt', 'stake', 'reward']):
                        info["classification"] = name_lower.split('_')[0]
                    else:
                        info["classification"] = "other"
                    sv_list.append(info)
            result["state_variables"] = sv_list
        except Exception as exc:
            result["state_variables_error"] = str(exc)

    json.dump(result, sys.stdout, indent=2)
    sys.stdout.write('\n')
