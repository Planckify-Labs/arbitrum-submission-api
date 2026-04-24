# Task 04 — DTO `@Expose` aliases to preserve outward JSON shape

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §4.2 (bottom bullet), §6.4 (DTO/API compatibility paragraph), §6.5

## Why this matters

Mobile and admin clients read JSON fields named `xenditChannelCode`,
`xenditAccountNumber`, `xenditAccountHolderName` in the merchant and
intent responses today. The task-03 rename changes the TypeScript
property names but must **not** flip the wire shape — deployed clients
in the field would break on deploy. Adding `@Expose` aliases lets the
server carry both names simultaneously until mobile/admin are flipped
in a follow-up release.

**Depends on:** task 03 (TS property names are already the new names).

## Scope

For each DTO that exposes a renamed field, use `class-transformer`
`@Expose({ name: "<old-wire-name>" })` — or the equivalent serializer
hook already in use — so JSON output keeps the old key while the TS
property is the new name.

Fields that need aliasing on output (non-exhaustive — verify each DTO):

| New TS property | Old JSON key to preserve |
|---|---|
| `payoutChannelCode` | `xenditChannelCode` |
| `payoutAccountNumber` (plaintext render, where applicable) | `xenditAccountNumber` |
| `payoutAccountHolderName` | `xenditAccountHolderName` |

DTO files in scope (from §6.4):

```
src/merchants/dto/merchant-response.dto.ts
src/merchants/dto/create-merchant.dto.ts
src/merchants/dto/patch-merchant.dto.ts
src/merchants/dto/channel-response.dto.ts
src/pay/dto/create-intent.dto.ts
src/pay/dto/payment-intent-response.dto.ts
src/pay/dto/nanopay-submit-response.dto.ts
src/admin/qris-disputes/dto/review-claim.dto.ts
```

For `channel-response.dto.ts` the per-provider fees now live on
`ProviderChannel`. Resolve the channel's fee for the merchant's
current provider inside the DTO mapper (using the `getProviderChannel`
helper from task 03) and surface it under the old JSON keys
(`xenditMinAmountIdr`, `xenditMaxAmountIdr`, `xenditFeeIdr`) for
backward compat. Add a `TODO(deprecation)` comment referencing the
follow-up release.

Input DTOs (create/patch) also accept the old keys — use
`@Transform` or accept both in the validator and map the old key to
the new TS property so existing callers keep working.

Swagger: update the `@ApiProperty` `name` option (or equivalent) so
`/docs` still shows the familiar field names. Adding the new names as
additional properties is acceptable but not required for v1.

## Rules (non-negotiable)

- **Outward wire-format is unchanged for v1.** Response JSON and
  accepted request JSON keep the `xendit*` names verbatim.
- **Tag every alias with a deprecation marker** (comment or JSDoc)
  referencing the follow-up release that will drop them. Future-us
  needs to find these fast.
- **Do not alias internal types or service method params** — only the
  DTO layer at the HTTP boundary.
- **Do not add new Duitku-branded keys yet.** Mobile/admin learn about
  "Duitku" via `merchant.payoutProvider`, not new field names.

## Acceptance

- [ ] Every renamed field in the §6.4 DTO file list has a working
      `@Expose` (or equivalent) alias back to its old JSON key on
      output.
- [ ] Input DTOs accept both old (`xenditChannelCode`) and new
      (`payoutChannelCode`) keys.
- [ ] Channel catalog responses surface per-provider fees under the
      old `xendit*` JSON keys, resolved from `ProviderChannel`.
- [ ] Hit each affected endpoint in a dev env and diff the response
      JSON against a captured pre-refactor fixture — keys and values
      match.
- [ ] A grep for `xenditChannelCode` / `xenditAccountNumber` /
      `xenditAccountHolderName` in DTO files only matches inside
      `@Expose({ name: "…" })`, `@ApiProperty({ name: "…" })`, or
      deprecation comments — never as a TS property name.

## Out of scope

- Flipping mobile/admin to the new names (follow-up release, research
  §8 item 2).
- Any Duitku-specific wire changes.
