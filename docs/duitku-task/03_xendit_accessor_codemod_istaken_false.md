# Task 03 — Codemod `xendit*` Prisma accessors / types across `src/`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §4.2, §6.4

## Why this matters

After tasks 01–02 rename the Prisma schema, every TypeScript file that
imports `XenditPayout`, reads `.xenditChannelCode`, calls
`prisma.xenditPayout.*`, or references the removed `Channel.xendit*`
fee columns fails to compile. This task is the mechanical rewrite that
restores the build — behavior-preserving, no new logic.

**Depends on:** tasks 01, 02 (schema is in the end-state).

## Scope

Mechanical rename across **non-generated** source. The canonical file
list is research §6.4:

```
src/payout/payout.service.ts
src/payout/payout.service.spec.ts
src/payout/payout-provider.port.ts
src/payout/payout.module.ts
src/payout/types.ts
src/payout/webhook.controller.ts
src/payout/webhook.controller.spec.ts
src/payout/account-number-crypto.ts                 (comments only)
src/payout/providers/xendit-payout.provider.ts
src/payout/providers/xendit-payout.provider.spec.ts
src/merchants/merchants.service.ts
src/merchants/merchants.service.spec.ts
src/merchants/dto/merchant-response.dto.ts
src/merchants/dto/create-merchant.dto.ts
src/merchants/dto/patch-merchant.dto.ts
src/merchants/dto/channel-response.dto.ts
src/pay/intents.service.ts
src/pay/intents.service.spec.ts
src/pay/intents.controller.ts
src/pay/dto/create-intent.dto.ts
src/pay/dto/payment-intent-response.dto.ts
src/pay/dto/nanopay-submit-response.dto.ts
src/admin/qris-disputes/dto/review-claim.dto.ts
src/admin/qris-disputes/qris-disputes.service.spec.ts
src/scripts/prisma/seed.ts
```

Renames to apply (1:1 substitutions):

- `prisma.xenditPayout.*` → `prisma.providerPayout.*`
- Type `XenditPayout` → `ProviderPayout`
- Type `XenditPayoutStatus` → `ProviderPayoutStatus`
- `.xenditChannelCode` → `.payoutChannelCode`
- `.xenditAccountNumber` → `.payoutAccountNumber`
- `.xenditAccountHolderName` → `.payoutAccountHolderName`
- `.xenditPayoutId` → `.providerPayoutId`
- `.xenditResponseBody` → `.providerResponseBody`
- `.xenditPayouts` → `.payouts` (Merchant relation accessor)

**Not mechanical** — requires a small lookup change: every read of the
old `channel.xenditMinAmountIdr` / `xenditMaxAmountIdr` / `xenditFeeIdr`
becomes a `providerChannel` lookup keyed by
`(channelCode, country, provider = merchant.payoutProvider)`. Build a
small helper (e.g. `getProviderChannel(prisma, merchant, channelCode)`)
in `src/payout/` and route callers through it — don't inline the
`findUnique` in every file.

`persistSuccess` / `persistFailure` in `PayoutService` now writes
`provider` and (when applicable) `providerResponseCode` onto
`ProviderPayout`.

## Rules (non-negotiable)

- **Behavior-preserving.** No new features here. Field renames +
  `providerChannel` lookup only. Wire-format to Xendit unchanged.
- **Run the codemod file-by-file and inspect diffs.** `xendit` is a
  substring trap — don't mass-rename across comments, test fixture
  strings, or the `XenditPayoutProvider` class name (which stays as
  `Xendit*Provider` until/unless we rename the class; that's not part
  of this task).
- **Do not rename the Xendit adapter class** (`XenditPayoutProvider`
  and its file stays `xendit-payout.provider.ts`). It's a concrete
  provider-specific implementation — a Xendit-branded identifier is
  correct there.
- **DTO outward field names are not renamed yet** — task 04 handles
  `@Expose` aliases so mobile/admin keep seeing `xenditChannelCode`
  etc. in JSON. Rename the TypeScript property names here;
  `class-transformer` hides the wire impact.
- **Regenerate the Prisma client once** at the start
  (`pnpm prisma generate`) so TS sees the new accessor names.

## Acceptance

- [ ] `pnpm run build` succeeds after the codemod.
- [ ] No references to `xenditPayout` / `xenditChannelCode` /
      `xenditAccountNumber` / `xenditAccountHolderName` /
      `xenditPayoutId` / `xenditResponseBody` / `xenditMinAmountIdr` /
      `xenditMaxAmountIdr` / `xenditFeeIdr` remain in non-test TS
      sources (grep clean).
- [ ] A `getProviderChannel(prisma, merchant, channelCode)` helper
      exists and centralizes the `(channelCode, country, provider)`
      lookup.
- [ ] `persistSuccess` / `persistFailure` write `provider` and
      `providerResponseCode` where applicable.
- [ ] `pnpm run test` green — existing Xendit specs pass with only
      property-name updates in assertions.

## Out of scope

- DTO `@Expose` aliases for wire-format stability (task 04).
- Any Duitku-specific code (tasks 05–09).
