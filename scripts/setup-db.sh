#!/bin/bash
set -e

echo "Starting database containers..."
docker compose up -d

echo "Waiting for PostgreSQL to be healthy..."
until docker exec takumipay-postgres pg_isready -U takumipay -d takumipay > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready!"

echo "Pushing schema to database..."
pnpm prisma db push

echo "Running Prisma seed..."
pnpm prisma db seed

echo "Database setup complete!"
