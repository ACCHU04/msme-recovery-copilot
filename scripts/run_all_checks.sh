#!/usr/bin/env bash
# scripts/run_all_checks.sh
# Run every quality gate locally in the same order that CI does.
#
# Usage:
#   ./scripts/run_all_checks.sh           # full suite
#   ./scripts/run_all_checks.sh --quick   # skip the production build (faster)
#
# Exit code is 0 only when every step passes.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
QUICK=false
for arg in "$@"; do [[ "$arg" == "--quick" ]] && QUICK=true; done

pass() { echo -e "\033[32m  ✔ $*\033[0m"; }
fail() { echo -e "\033[31m  ✘ $*\033[0m"; exit 1; }
section() { echo -e "\n\033[1m=== $* ===\033[0m"; }

# ---------------------------------------------------------------- backend
section "Backend — pytest"
cd "$REPO_ROOT/backend"
if [[ -f "$REPO_ROOT/backend/.venv/bin/pytest" ]]; then
  PYTEST_CMD="$REPO_ROOT/backend/.venv/bin/pytest"
elif [[ -f "$REPO_ROOT/backend/.venv/Scripts/pytest.exe" ]]; then
  PYTEST_CMD="$REPO_ROOT/backend/.venv/Scripts/pytest.exe"
elif command -v pytest &>/dev/null; then
  PYTEST_CMD="pytest"
else
  PYTEST_CMD="python -m pytest"
fi
STORE=memory "$PYTEST_CMD" --tb=short -q && pass "pytest" || fail "pytest"

# ---------------------------------------------------------------- frontend
section "Frontend — typecheck"
cd "$REPO_ROOT/frontend"
npm run typecheck && pass "typecheck" || fail "typecheck"

section "Frontend — lint"
npm run lint && pass "lint" || fail "lint"

section "Frontend — unit tests"
npm test -- --run && pass "unit tests" || fail "unit tests"

if [[ "$QUICK" == false ]]; then
  section "Frontend — production build"
  NEXT_PUBLIC_DEMO_MODE=true npm run build && pass "build" || fail "build"
fi

echo -e "\n\033[32;1mAll checks passed.\033[0m"
