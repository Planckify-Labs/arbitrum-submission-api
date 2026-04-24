# Task 08 — Add `Blockchain.takumiWalletContract`, `quoteSignerAddress`, `minConfirmations`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §5.5

## Why this matters

The onchain adapter resolves the contract address and expected signer
from the `Blockchain` row — per-chain config, not env. Per-chain
`minConfirmations` overrides the global env to handle L2s with fast
block times (e.g., Arbitrum needs 720 blocks for ~180s wallclock).

## Scope

Add to `Blockchain` in `prisma/schema.prisma`:

```prisma
takumiWalletContract String?
quoteSignerAddress   String?
minConfirmations     Int?
```

- Generate and apply the Prisma migration.
- Populate the Arc testnet row with the contract address from task 02
  and the testnet signer address (can be done via seed or manual SQL
  after deploy).
- Populate `minConfirmations` per the tuning table in §5.5:
  - Ethereum mainnet: 12
  - Arbitrum One: 720
  - Optimism / Base: 90
  - Polygon PoS: 256
  - BSC: 60
  - Arc testnet: 90

## Rules (non-negotiable)

- **All columns nullable.** Chains without a deployed contract leave
  these `NULL`.
- **`minConfirmations` overrides env.** The fallback chain is:
  `Blockchain.minConfirmations` → `ONCHAIN_MIN_CONFIRMATIONS` env →
  `MIN_CONFIRMATIONS` env → `12`.
- **`quoteSignerAddress`** is a public address (not a private key).
  Never store private keys in the DB.

## Acceptance

- [ ] `prisma/schema.prisma` has all three columns on `Blockchain`.
- [ ] `pnpm prisma migrate dev` applies cleanly.
- [ ] `bash scripts/lint-migrations.sh` passes.
- [ ] `pnpm prisma generate` succeeds.
- [ ] Arc testnet row can be populated (seed or documented SQL).

## Out of scope

- Boot-time signer assertion using `quoteSignerAddress` (task 14).
- Reading `takumiWalletContract` in the adapter (task 18).
- Reading `minConfirmations` in the adapter (task 18).
