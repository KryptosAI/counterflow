#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_URL="https://github.com/SunWeb3Sec/DeFiHackLabs.git"
TMP_DIR="$(mktemp -d)"

echo "==> Cloning DeFiHackLabs (shallow, blobless) into $TMP_DIR ..."
git clone --depth 1 --filter=blob:none "$REPO_URL" "$TMP_DIR/DeFiHackLabs"

echo ""
echo "==> Searching for target contracts ..."

declare -A TARGETS
TARGETS=(
  ["FeiProtocol.sol"]="fei"
  ["CreamFinance.sol"]="cream"
  ["PancakeBunny.sol"]="pancake"
  ["OpenLeverage.sol"]="openlever"
  ["BeltFinance.sol"]="belt"
)

COPIED=0
MISSING=()

for contract in "${!TARGETS[@]}"; do
  pattern="${TARGETS[$contract]}"
  found=$(find "$TMP_DIR/DeFiHackLabs" -type f -iname "*${contract}" -o -iname "*${pattern}*.sol" 2>/dev/null | head -1)
  if [ -n "$found" ]; then
    cp "$found" "$SCRIPT_DIR/$contract"
    echo "  ✓ copied $contract from $(basename "$(dirname "$found")")/"
    COPIED=$((COPIED + 1))
  else
    MISSING+=("$contract")
    echo "  ✗ $contract not found in repo"
  fi
done

echo ""
echo "==> Copying supplementary files (test scripts, PoCs) ..."

INV_FILES=$(find "$TMP_DIR/DeFiHackLabs" -type f -name "*.invariants.txt" 2>/dev/null || true)
if [ -n "$INV_FILES" ]; then
  while IFS= read -r f; do
    cp "$f" "$SCRIPT_DIR/$(basename "$f")"
    echo "  ✓ copied $(basename "$f")"
  done <<< "$INV_FILES"
fi

echo ""
echo "==> Cleaning up temp clone ..."
rm -rf "$TMP_DIR"

echo ""
echo "================================================"
echo "  Copied $COPIED/${#TARGETS[@]} target contracts"
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "  Missing: ${MISSING[*]}"
  echo "  You may need to locate these manually in:"
  echo "    $REPO_URL"
fi
echo ""
echo "  License: Apache-2.0 (compatible with this project's MIT)"
echo "  Contracts are from the DeFiHackLabs repository and are"
echo "  used for educational / benchmark purposes only."
echo "================================================"
