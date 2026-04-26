# Task 01 — Create `flip-channels.ts` canonical → Flip bank code mapping

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.8, §4.7

## Why this matters

The adapter needs to translate our canonical channel codes (e.g. `BCA`,
`GOPAY`) into Flip's proprietary bank codes (e.g. `bca`, `gopay`).
This mapping lives in a dedicated file so both the adapter and the seed
script can import it. Mirrors the existing `duitku-channels.ts` pattern.

**Depends on:** nothing — can start immediately.

## Scope

Create `src/payout/flip-channels.ts`:

- Export a `FLIP_CHANNEL_CODES` const mapping from canonical channel
  code to Flip's `bank_code` string.
- Phase 1 channels only (from spec §4.7):

| Canonical Code | Flip `bank_code` | Kind |
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

- Type the mapping as `Record<string, string>` (or a more specific
  union type if the codebase uses one for canonical codes).
- The full §2.8 list (100+ banks) is the reference for future expansion
  but should NOT be included in v1 — keep the file focused on channels
  we actually support.

Follow the exact pattern of `duitku-channels.ts` — same export shape,
same file location, same naming convention.

## Rules (non-negotiable)

- **Single source of truth.** This file is the only place Flip bank
  codes are defined. The seed script, the adapter, and any admin
  tooling import from here — no duplicated mappings.
- **Only include channels that exist on `Channel` table.** If a
  canonical code doesn't have a `Channel` row, it doesn't belong here.
- **Lowercase Flip codes exactly as documented.** Flip's API is
  case-sensitive on `bank_code` — `bca` not `BCA`.

## Acceptance

- [ ] `src/payout/flip-channels.ts` exists with a named export
      `FLIP_CHANNEL_CODES`.
- [ ] All 14 Phase 1 channels from spec §4.7 are present.
- [ ] Values match Flip's documented `bank_code` exactly (lowercase).
- [ ] File follows the same pattern as `duitku-channels.ts`.
- [ ] `pnpm run build` green.

## Out of scope

- Full §2.8 bank list (100+ entries) — future expansion as merchant
  demand requires.
- Runtime sync with `GET /general/banks` — static mapping is sufficient
  for launch.
