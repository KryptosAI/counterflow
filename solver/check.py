#!/usr/bin/env python3
"""
Counterflow trusted solver entrypoint.

Reads a validated "binding" JSON on stdin, discharges every function/invariant
obligation via Z3 (see models.py), and writes a verdict JSON to stdout.

Supported models (binding.model): erc20_pool, amm_pool, lending_pool,
staking_pool, cross_contract.

Proof modes (binding.induction.k):
    k=1 (default) — 1-induction per function (preservation only).
    k=2..5        — k-induction over the whole transition relation, with
                    initiation checked by BMC from binding.init (e.g.
                    "init": ["all_zero"]). Opt-in; requires a non-empty
                    init block.
"""
import json, sys
from models import (
    check_function, check_vacuity, check_k_induction,
    GUARDS, EFFECTS, INVARIANTS, INIT_PREDS,
)


def fail(msg):
    print(json.dumps({"error": msg}))
    sys.exit(2)


def main():
    raw = sys.stdin.read()
    binding = json.loads(raw)
    model = binding.get("model", "erc20_pool")
    invariants = binding.get("invariants", [])
    init_names = binding.get("init", []) or []
    induction = binding.get("induction", {}) or {}
    k = induction.get("k", 1)

    for inv in invariants:
        if inv not in INVARIANTS:
            fail(f"unknown invariant: {inv}")
    for name in init_names:
        if name not in INIT_PREDS:
            fail(f"unknown init predicate: {name}")
    if not isinstance(k, int) or isinstance(k, bool) or k < 1 or k > 5:
        fail("induction.k must be an integer between 1 and 5")
    if k > 1 and not init_names:
        fail('induction.k > 1 requires a non-empty init block (e.g. "init": ["all_zero"])')
    if init_names and k == 1:
        print("warning: init block present but induction.k=1 — init unused; "
              "set induction.k >= 2 to enable k-induction", file=sys.stderr)

    funcs = binding.get("functions", [])
    for func in funcs:
        for g in func.get("guards", []):
            if g not in GUARDS:
                fail(f"unknown guard: {g}")
        for e in func.get("effects", []):
            if e not in EFFECTS:
                fail(f"unknown effect: {e}")

    vacuity = []
    for func in funcs:
        v = check_vacuity(func, invariants, model=model)
        if v:
            print(f"warning: function '{func['name']}' has unsatisfiable guards — proofs are vacuous",
                  file=sys.stderr)
        vacuity.append({"function": func["name"], "vacuous": v})

    if k > 1:
        ki = check_k_induction(funcs, invariants, model, init_names, k)
        any_violation = any(r["status"] == "violated" for r in ki["invariants"])
        any_unknown = any(r["status"] == "unknown" for r in ki["invariants"])
        verdict = "violated" if any_violation else ("unknown" if any_unknown else "proved")
        print(json.dumps({
            "verdict": verdict,
            "model": model,
            "proof": {"kind": "k-induction", "k": k, "init": init_names},
            "invariants": ki["invariants"],
            "functions": vacuity,
        }, indent=2))
        return

    func_results = []
    any_violation = False
    any_unknown = False

    for i, func in enumerate(funcs):
        results = check_function(func, invariants, model=model)
        for r in results:
            if r["status"] == "violated":
                any_violation = True
            elif r["status"] == "unknown":
                any_unknown = True
        func_results.append({"function": func["name"],
                             "vacuous": vacuity[i]["vacuous"],
                             "results": results})

    if any_violation:
        verdict = "violated"
    elif any_unknown:
        verdict = "unknown"
    else:
        verdict = "proved"

    print(json.dumps({
        "verdict": verdict,
        "model": model,
        "proof": {"kind": "1-induction", "k": 1},
        "functions": func_results,
    }, indent=2))


if __name__ == "__main__":
    main()
