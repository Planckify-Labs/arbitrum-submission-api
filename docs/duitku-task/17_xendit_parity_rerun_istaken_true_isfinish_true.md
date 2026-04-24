# Task 17 — Re-run existing Xendit spec unchanged post-rename

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §6.5, §7 bullet 10

## Why this matters

The entire point of tasks 01–04's rename being `ALTER … RENAME` (not
drop/create) is that the Xendit flow stays byte-identical on the
wire. The existing `xendit-payout.provider.spec.ts` is the best
proof: if every assertion still passes with only property-name
updates, we know Xendit behavior is preserved. If the spec needs
material logic changes to pass, we've accidentally changed Xendit
behavior and must find out why.

**Depends on:** all prior tasks merged — this is a validation pass,
not new code.

## Scope

Open `src/payout/providers/xendit-payout.provider.spec.ts` and apply
only the property-name updates dictated by the rename (from research
§6.4):

- `xenditChannelCode` → `payoutChannelCode` in any merchant fixture.
- `xenditAccountNumber` → `payoutAccountNumber`.
- `xenditAccountHolderName` → `payoutAccountHolderName`.
- `xenditPayoutId` → `providerPayoutId` in any receipt fixture.
- `xenditResponseBody` → `providerResponseBody`.
- `XenditPayout` / `XenditPayoutStatus` type imports →
  `ProviderPayout` / `ProviderPayoutStatus`.
- `prisma.xenditPayout` → `prisma.providerPayout` in any
  test-level DB calls.
- `channel.xenditFeeIdr` / `xenditMinAmountIdr` / `xenditMaxAmountIdr`
  → lookup via `providerChannel` where `provider = 'xendit'` (use the
  `getProviderChannel` helper from task 03).

That should be the **entire** diff on this file. Any additional
logic change is a red flag — dig into it before forcing the test
green.

Run:

```bash
pnpm run test -- --testPathPattern=xendit-payout.provider
```

Every assertion must pass without modification.

Additionally:

- Verify the Xendit adapter still produces the same request body it
  did before the refactor. A good proof: capture the mocked
  transport's request in one happy-path test and `JSON.stringify`
  it; the URL, headers (including `Idempotency-key` value), and
  body must match a pre-refactor fixture exactly (copy the fixture
  from a pre-refactor branch or reconstruct from memory of the
  code). This is the wire-format guarantee from research §6.5.

## Rules (non-negotiable)

- **Property-name-only diffs.** If you find yourself editing logic,
  a mock return value, or an assertion target (not just its
  property name), stop — something in the rename broke Xendit.
  Fix the rename, not the test.
- **Do not loosen an assertion** to make the test pass. A loosened
  assertion in this spec is a regression.
- **Request body wire-format fixture** must capture the same bytes
  the Xendit adapter was sending before the refactor. `channel_code`,
  `account_number`, `account_holder_name`, etc. on the request to
  Xendit are unchanged by the refactor — task 03's codemod only
  renamed the TS fields we **read from**, not the request fields we
  **write to Xendit with**.
- **Commit the wire-format fixture** (`xendit-request-body.fixture.json`
  or similar) in the same PR, so future work has a regression anchor.

## Acceptance

- [ ] Diff on `xendit-payout.provider.spec.ts` is limited to property
      renames (reviewer can scan and confirm).
- [ ] `pnpm run test -- --testPathPattern=xendit-payout.provider`
      passes.
- [ ] A wire-format request fixture is committed and one happy-path
      test deep-equals the mocked transport's captured request
      against it.
- [ ] No loosened assertions, no `.skip()` added.

## Out of scope

- Extending the Xendit test matrix — not this task.
- Migrating Xendit unit tests to a new style — not this task.
