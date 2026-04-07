#!/usr/bin/env bash
# Fail if any migration SQL adds a FK that references a TimescaleDB hypertable.
# Hypertable chunks live in _timescaledb_internal, causing Prisma P4002 errors.
# Referential integrity to these tables must be enforced at the application level.
#
# Usage:
#   ./scripts/lint-migrations.sh              # check all migrations after SINCE_MIGRATION
#   ./scripts/lint-migrations.sh <file.sql>   # check a specific file

set -euo pipefail

HYPERTABLES=("TransactionHistory" "PointTransaction" "AdminAuditLog" "ExchangeRate")

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../prisma/migrations" && pwd)"

# Migrations up to and including this one already had FKs that were later fixed.
# Only migrations created after this point are checked.
SINCE_MIGRATION="20260407000000_drop_point_redemption_hypertable_fk"

FAILED=0

if [[ $# -gt 0 ]]; then
  FILES=("$@")
else
  FILES=()
  while IFS= read -r f; do
    FILES+=("$f")
  done < <(find "$MIGRATIONS_DIR" -name "migration.sql" | sort | awk -v since="$MIGRATIONS_DIR/$SINCE_MIGRATION" '$0 > since')
fi

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "Migration lint passed — no new migrations to check."
  exit 0
fi

for table in "${HYPERTABLES[@]}"; do
  for file in "${FILES[@]}"; do
    matches=$(grep -n "REFERENCES[[:space:]]*\"${table}\"" "$file" 2>/dev/null || true)
    if [[ -n "$matches" ]]; then
      echo "ERROR: FK targeting hypertable '${table}' in $file:"
      echo "$matches"
      echo "  → Remove the FK. Enforce referential integrity at the application level."
      FAILED=1
    fi
  done
done

if [[ $FAILED -eq 1 ]]; then
  exit 1
fi

echo "Migration lint passed — no FKs targeting TimescaleDB hypertables."
