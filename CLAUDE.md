# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

TakumiPay API is a NestJS-based payment API that enables cryptocurrency payments for digital products (gift cards, game vouchers, etc.). It integrates with blockchain networks for payment verification and external vendor APIs for product fulfillment.

## Common Commands

```bash
# Install dependencies
pnpm install

# Development
pnpm run start:dev       # Watch mode with hot reload

# Build & Production
pnpm run build           # Compile TypeScript
pnpm run start:prod      # Run compiled code

# Testing
pnpm run test            # Run unit tests
pnpm run test:watch      # Watch mode
pnpm run test -- --testPathPattern=<pattern>  # Run specific test file
pnpm run test:e2e        # End-to-end tests
pnpm run test:cov        # Coverage report

# Linting & Formatting
pnpm run lint            # ESLint with auto-fix
pnpm run format          # Prettier formatting

# Database
pnpm prisma generate     # Generate Prisma client (outputs to generated/prisma/)
pnpm prisma migrate dev  # Apply migrations in development
pnpm prisma db seed      # Seed database (runs src/scripts/prisma/seed.ts)
```

## Architecture

### Core Flow: Booking -> Payment -> Purchase

1. **Booking** (`src/booking/`): User reserves a product with price locked via exchange rate. Bookings expire after configurable time (default 15 min).
2. **Transaction** (`src/transactions/`): User submits blockchain transaction hash after payment.
3. **Blockchain Verification** (`src/blockchain-verification/`): Verifies transaction on-chain using `viem`. Validates against smart contract state via `getTransactionByRef`.
4. **Queue Processing** (`src/queue/`): BullMQ queues handle async processing - purchase fulfillment, blockchain verification retries, vendor API calls.
5. **Vendor Fulfillment** (`src/providers/vendor-api/`): Calls external vendor APIs (e.g., VCGamers) to deliver digital products.

### Authentication

Two authentication mechanisms running as global guards (`APP_GUARD`):

- **JwtAuthGuard**: JWT-based auth for users. Use `@Public()` decorator to bypass.
- **ApiKeyGuard**: API key auth via `X-API-Key` header. Use `@ApiKeyRequired()` decorator to enforce.

Wallet-based auth uses SIWE (Sign-In with Ethereum). Admin auth uses username/password with argon2 hashing.

### Key Modules

- **PrismaModule**: Database access. Prisma client generated to `generated/prisma/`.
- **ValkeyModule**: Redis-compatible cache (Valkey). Services for nonce caching, rate limiting, vendor API response caching.
- **QueueModule**: BullMQ job queues - `purchase-processing`, `blockchain-verification`, `vendor-api-calls`.
- **BlockchainVerificationModule**: Multi-chain support. Dynamically creates viem clients from database-stored blockchain configs.

### Vendor API Pattern

New vendor integrations extend `BaseVendorService` in `src/providers/vendor-api/base/`. Current implementation: VCGamers (`src/providers/vendor-api/implementations/vcgamers/`).

### Database

PostgreSQL with Prisma ORM. Schema at `prisma/schema.prisma`. Uses ULID for IDs. TimescaleDB extension for `ExchangeRate` time-series data.

## Environment Variables

Key variables (see `.env.example`):

- `DATABASE_URL`: PostgreSQL connection string
- `VALKEY_HOST/PORT`: Redis-compatible cache
- `JWT_SECRET`, `JWT_EXPIRATION_TIME`: Auth tokens
- `ADMIN_WALLET_PRIVATE_KEY`: For blockchain transaction signing (must be 0x-prefixed, 66 chars)
- `SIWE_DOMAIN/URI/STATEMENT`: Sign-In with Ethereum config
- `VCGAMERS_SECRET`: Vendor API credentials

## Decorators

- `@Public()`: Skip JWT auth
- `@ApiKeyRequired()`: Require X-API-Key header
- `@Roles(UserRole.ADMIN)`: Require specific user role
- `@RateLimit()`: Apply rate limiting

## Swagger

API docs available at `/docs` when running. Configured in `src/config/swagger.config.ts`.
