#!/bin/sh
set -e

echo "Running Prisma db push to sync schema..."
npx prisma db push --accept-data-loss

if [ "${RUN_SEED:-false}" = "true" ]; then
  echo "Running database seed..."
  node dist/scripts/prisma/seed.js
fi

echo "Starting application..."
exec node dist/main
