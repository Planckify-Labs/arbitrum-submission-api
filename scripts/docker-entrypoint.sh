#!/bin/sh
set -e

echo "Running Prisma db push to sync schema..."
npx prisma db push --accept-data-loss

echo "Running database seed..."
node dist/scripts/prisma/seed.js

echo "Starting application..."
exec node dist/main
