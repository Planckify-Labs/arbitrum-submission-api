#!/bin/bash
set -e

echo "Starting production containers..."
docker compose -f docker-compose.prod.yml up -d --build

echo "Waiting for PostgreSQL to be healthy..."
until docker exec takumipay-postgres pg_isready -U takumipay -d takumipay > /dev/null 2>&1; do
  sleep 1
done
echo "PostgreSQL is ready!"

echo "Running Prisma db push inside container..."
docker exec takumipay-api pnpm prisma db push --skip-generate

echo "Production setup complete!"
echo "API available at: http://localhost:4000"
echo "Swagger docs at: http://localhost:4000/docs"
echo "Health check at: http://localhost:4000/health"
