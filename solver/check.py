#!/usr/bin/env python3
"""
Counterflow trusted solver entrypoint.

Reads a validated "binding" JSON on stdin, discharges every function/invariant
obligation via Z3 (see models.py), and writes a verdict JSON to stdout.

Supported models (binding.model): erc20_pool, amm_pool, lending_pool,
staking_pool, cross_contract.
"""
import json, sys
from models import check_function, check_vacuity, GUARDS, EFFECTS, INVARIANTS


def main():
    raw = sys.stdin.read()
    binding = json.loads(raw)
    model = binding.get("model", "erc20_pool")
    invariants = binding.get("invariants", [])

    for inv in invariants:
        if inv not in INVARIANTS:
            print(json.dumps({"error": f"unknown invariant: {inv}"}))
            sys.exit(2)

    func_results = []
    any_violation = False
    any_unknown = False

    for func in binding.get("functions", []):
        for g in func.get("guards", []):
            if g not in GUARDS:
                print(json.dumps({"error": f"unknown guard: {g}"}))
                sys.exit(2)
        for e in func.get("effects", []):
            if e not in EFFECTS:
                print(json.dumps({"error": f"unknown effect: {e}"}))
                sys.exit(2)
        results = check_function(func, invariants, model=model)
        for r in results:
            if r["status"] == "violated":
                any_violation = True
            elif r["status"] == "unknown":
                any_unknown = True
        vacuous = check_vacuity(func, invariants, model=model)
        if vacuous:
            print(f"warning: function '{func['name']}' has unsatisfiable guards — proofs are vacuous", file=sys.stderr)
        func_results.append({"function": func["name"], "vacuous": vacuous, "results": results})

    if any_violation:
        verdict = "violated"
    elif any_unknown:
        verdict = "unknown"
    else:
        verdict = "proved"

    print(json.dumps({"verdict": verdict, "model": model, "functions": func_results}, indent=2))


if __name__ == "__main__":
    main()
