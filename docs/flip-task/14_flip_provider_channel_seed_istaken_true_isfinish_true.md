# Task 14 — Seed `ProviderChannel` rows for `flip` per channel

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §4.7, §9

## Why this matters

The adapter's `triggerPayout` resolves `bank_code` via
`ProviderChannel` where `provider = "flip"`. Without seeded rows,
no Flip payout can execute. The seed script must produce `flip` rows
alongside existing `xendit` and `duitku` rows for every canonical
channel so the adapter finds what it needs the moment a merchant is
set to `payoutProvider = "flip"`.

**Depends on:** task 01 (`FLIP_CHANNEL_CODES` mapping available).

## Scope

Edit `src/scripts/prisma/seed.ts`:

- For each `Channel` row the seed creates, also create a
  `ProviderChannel` row for `provider = "flip"`:
  - `providerChannelCode` = Flip's bank code from `FLIP_CHANNEL_CODES`
    (task 01), e.g. `BCA` → `"bca"`, `GOPAY` → `"gopay"`.
  - `feeIdr` = Flip's per-bank fee from spec §9. Seed with current
    known fees (available via `GET /general/banks`). Use reasonable
    defaults if exact fees aren't known — ops can tune later.
  - `isActive = true` for Phase 1 channels.

- Import `FLIP_CHANNEL_CODES` from `src/payout/flip-channels.ts` —
  do NOT duplicate the mapping in the seed file.

- Use `upsert` on the unique key `(channelCode, country, provider)`
  so re-running seed is idempotent.

Phase 1 channel mapping (from spec §4.7 / task 01):

| Canonical | Flip `bank_code` | Kind |
|---|---|---|
| `BCA` | `bca` | bank |
| `MANDIRI` | `mandiri` | bank |
| `BNI` | `bni` | bank |
| `BRI` | `bri` | bank |
| `CIMB` | `cimb` | bank |
| `PERMATA` | `permata` | bank |
| `BTPN` | `tabungan_pensiunan_nasional` | bank |
| `BSI` | `bsm` | bank |
| `JAGO` | `artos` | bank |
| `OVO` | `ovo` | ewallet |
| `GOPAY` | `gopay` | ewallet |
| `DANA` | `dana` | ewallet |
| `SHOPEEPAY` | `shopeepay` | ewallet |
| `LINKAJA` | `linkaja` | ewallet |

## Rules (non-negotiable)

- **`upsert`, not `create`.** The seed must be idempotent — running
  it twice on the same DB is a no-op.
- **No live HTTP calls during seed.** Do not call
  `${FLIP_API_BASE}/general/banks` — that introduces network
  dependency on `pnpm prisma db seed`. The mapping is static.
- **Only add canonical codes that already exist on `Channel`.** If a
  seed run finds no `Channel` row for a canonical code in the
  mapping, skip that row with a `console.warn` — don't implicitly
  create the `Channel`.
- **Import from `FLIP_CHANNEL_CODES`, don't duplicate.** Single source
  of truth for the mapping.
- **Do not modify existing Xendit or Duitku seed rows.** This task
  only adds `flip` rows.

## Acceptance

- [ ] `pnpm prisma db seed` on a freshly migrated DB produces one
      `flip` `ProviderChannel` row per `Channel` row that has a
      `FLIP_CHANNEL_CODES` mapping.
- [ ] Running the seed a second time changes no rows (counts
      identical, `updatedAt` unchanged on pre-existing rows).
- [ ] The Flip `providerChannelCode` values match the mapping in
      task 01 / spec §4.7.
- [ ] Missing `Channel` rows produce `console.warn` without failing
      the seed.
- [ ] Existing `xendit` and `duitku` `ProviderChannel` rows are
      unchanged.
- [ ] `FLIP_CHANNEL_CODES` is imported, not duplicated.

## Out of scope

- Admin UI for managing per-provider fees — future work.
- Fee reconciliation with `GET /general/banks` — deferred (spec §9).
- Additional banks beyond Phase 1 — future expansion as demand requires.
