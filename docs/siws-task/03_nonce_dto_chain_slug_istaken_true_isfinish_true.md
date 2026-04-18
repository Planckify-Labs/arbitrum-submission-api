# Task 03 — `NonceDto.chainSlug` + `chainId` mutual exclusion

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §2.3 gap 5, §3.3

## Why this matters

`GET /auth/nonce/:walletAddress` today accepts `?chainId=<int>` only.
Solana does not have a numeric chain id — the cluster is
`"mainnet"` / `"devnet"`, already stored as `Blockchain.chainSlug`
(`"solana-mainnet"`, `"solana-devnet"`). The DTO must accept a string
`chainSlug` and reject nonsense combinations so the controller's
namespace inference (task 09) can trust its inputs.

## Scope

Edit the nonce query DTO under `src/auth/` (the DTO currently holding
`chainId`):

- Add `chainSlug?: string` with `@IsString() @IsOptional()` and a
  format constraint: matches `/^[a-z0-9]+(-[a-z0-9]+)*$/`.
- Keep `chainId?: number` with its existing validation.
- Add cross-field validation: **exactly zero or one** of `chainId` /
  `chainSlug` may be set. Both-set → `400 Bad Request` with a message
  like `"chainId and chainSlug are mutually exclusive"`.
- Allowed values for `chainSlug` are **not hard-coded** in the DTO.
  The controller/service resolves the slug against `Blockchain` rows;
  the DTO only enforces shape.

## Rules (non-negotiable)

- **No enum of chain slugs in the DTO.** Seeded chain slugs live in
  the database; the DTO must not drift when a new chain is added.
- **Neither field required.** Missing both = EVM default (today's
  behavior) — task 09 enforces this fallback.
- **Use class-validator**, matching existing DTOs in the module. Do
  not pull in Zod for one DTO.

## Acceptance

- [ ] `chainSlug` field added with string/regex validation.
- [ ] Mutual-exclusion validator rejects `{ chainId: 1, chainSlug: "solana-mainnet" }`
      with HTTP 400.
- [ ] DTO unit test covers: both present → reject; only `chainId` →
      accept; only `chainSlug` → accept; neither → accept; `chainSlug`
      with uppercase or spaces → reject.
- [ ] OpenAPI/Swagger output shows the new query param with examples
      (`"solana-mainnet"`, `"solana-devnet"`).

## Out of scope

- Controller logic that chooses SIWE vs SIWS based on these fields
  (task 09).
- Adding new `Blockchain` rows — Solana rows already exist per
  `SIWS_SPEC.md` §2.1.
