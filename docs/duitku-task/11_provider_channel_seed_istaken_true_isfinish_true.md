# Task 11 — Seed `ProviderChannel` rows for `xendit` + `duitku` per channel

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.7 (channel code comparison), §4.2 (seed update), §6.1

## Why this matters

Task 02's migration backfills one `ProviderChannel` row per existing
`Channel` for `xendit` only. For dev / CI / new environments, the seed
script has to produce both `xendit` **and** `duitku` rows for every
canonical channel so the adapter's channel lookup finds what it needs
the moment a merchant is set to `payoutProvider = "duitku"`.

**Depends on:** tasks 01, 02 (schema is in end-state), task 10
(env vars available for `listBank` seeding if we use that path).

## Scope

Edit `src/scripts/prisma/seed.ts`:

- For each `Channel` row the seed creates, also create two
  `ProviderChannel` rows:
  - `provider = "xendit"`, `providerChannelCode = <canonical>` (they
    match today — `BCA` → `BCA`, `GOPAY` → `GOPAY`).
  - `provider = "duitku"`, `providerChannelCode = <Duitku code>` from
    the table in research §2.7 (e.g. `BCA` → `"014"`, `GOPAY` →
    `"1011"`).
- Use an explicit mapping table inside the seed file — do **not**
  derive the Duitku code by live-calling `listBank` at seed time.
  A seed run must be offline-reproducible.
- `minAmountIdr` / `maxAmountIdr` / `feeIdr` for Duitku rows: use
  sensible dev defaults (e.g. mirror the Xendit fee for now). Ops can
  tune in prod via admin tooling later.
- Use `upsert` on the unique key `(channelCode, country, provider)`
  so re-running the seed is idempotent.

Keep the existing `Channel` seed data untouched — canonical metadata
(label, icon, `accountFormat`, `priority`) is the merchant-facing
catalog and doesn't change here.

Explicit mapping table to include (from research §2.7):

| Canonical | Xendit code | Duitku code |
|---|---|---|
| `BCA` | `BCA` | `014` |
| `MANDIRI` | `MANDIRI` | `008` |
| `BNI` | `BNI` | `009` |
| `BRI` | `BRI` | `002` |
| `CIMB` | `CIMB` | `022` |
| `PERMATA` | `PERMATA` | `013` |
| `BTPN` | `BTPN` | `213` |
| `BSI` | `BSI` | `451` |
| `JAGO` | `JAGO` | `542` |
| `OVO` | `OVO` | `1010` |
| `GOPAY` | `GOPAY` | `1011` |
| `DANA` | `DANA` | `1012` |
| `SHOPEEPAY` | `SHOPEEPAY` | `1013` |
| `LINKAJA` | `LINKAJA` | `1014` |

Surface the mapping as a const (e.g. `DUITKU_CHANNEL_CODES`) so it
can be imported by the seed and any admin tooling that needs it
later.

## Rules (non-negotiable)

- **`upsert`, not `create`.** The seed must be idempotent — running
  it twice on the same DB is a no-op.
- **No live HTTP calls during seed.** Do not call
  `${DUITKU_API_BASE}/listBank` — that introduces network dependency
  on `pnpm prisma db seed`. The mapping table is static enough to
  pin.
- **Only add canonical codes that already exist on `Channel`.** If a
  seed run finds no `Channel` row for a canonical code in the
  mapping, skip that row with a `console.warn` — don't implicitly
  create the `Channel`.
- **Duitku rows default to `isActive = true`** unless the canonical
  `Channel.isActive` is `false`.

## Acceptance

- [ ] `pnpm prisma db seed` on a freshly migrated DB produces one
      `xendit` and one `duitku` `ProviderChannel` row per `Channel`
      row present in the seed.
- [ ] Running the seed a second time changes no rows (counts
      identical, `updatedAt` unchanged on pre-existing rows).
- [ ] The Duitku code column values match the research §2.7 table
      for every entry present.
- [ ] Missing `Channel` rows produce `console.warn` without failing
      the seed.
- [ ] `DUITKU_CHANNEL_CODES` (or equivalent) is exported from a
      single module — not duplicated across the seed and any other
      file that may need it.

## Out of scope

- Admin UI for managing per-provider fees — future work.
- Runtime sync with Duitku's `listBank` API — future work; static
  table is sufficient for launch.
