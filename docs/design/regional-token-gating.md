# Regional Token Gating — the hardcoded country allowlist, what actually gates payments, and how to do it properly

**Status:** Findings + recommendation. No code changed. Decision needed.
**Found during:** Monad mainnet activation, 2026-09-19 — the allowlist was initially misdiagnosed as the reason Monad showed as "not available" for point deposits.
**Related:** `prisma/schema.prisma` (`Region`, `RegionAvailableToken`, `User.regionId`), `src/regions/`, `src/blockchains/blockchains.service.ts`, `mobile-app/hooks/deposit/useDepositState.ts`.

## 1. The hardcoded allowlist

`src/blockchains/blockchains.service.ts`:

```ts
/**
 * Country → allow-list of EVM chainIds a payer in that jurisdiction can use.
 * Spec §6.7 + task 21: M2 ships Indonesia on Arc Testnet only. …
 */
const DEFAULT_COUNTRY_ALLOWLIST: Readonly<Record<string, readonly number[]>> = {
  ID: [5042002, 10143],
};
```

plus a `BLOCKCHAINS_COUNTRY_ALLOWLIST_<ISO>` env override, `resolveCountryAllowlist()`, a `GetBlockchainsQueryDto` with a `country` field, and a country segment in the Valkey cache key for the enriched `/blockchains` payload.

### 1.1 Facts (all verified, none inferred)

| Claim | Evidence |
|---|---|
| Introduced in commit `b4c3a82`, 2026-04-21 | `git log -S DEFAULT_COUNTRY_ALLOWLIST` |
| Its comment cites "spec §6.7 + task 21" — neither describes country→chain gating | `mobile-app/docs/umkm-usdc-payout-spec.md` §6.7 and `umkm-usdc-payout-task/21_chain_config_endpoint_m2_istaken_true.md` describe the *enriched payload* (gateway/paymaster/x402 objects). Spec §1 says "v1 scope: Indonesia only" as product scope, not as a chain filter. |
| It filters **only** `GET /blockchains?country=<iso>` | `buildEnrichedConfig(country?)` is the sole call site |
| The mobile app **never sends `country`** to `/blockchains` | grep over `mobile-app/api/`, `hooks/`, `services/` — `country` is only passed to `/merchants/channels` (`useChannelsWithStorage`) |
| No server-side payment or deposit path consults it | `points.service.ts` and `pay/intents.service.ts` never import `BlockchainsService` or `resolveCountryAllowlist` |
| Only `ID` has an entry; any other country → `[]` | `resolveCountryAllowlist` returns `null` → `where.chainId = { in: [] }` |

**Net:** it is dead code. It has never gated a chain, a token, or a payment for any user. It is also a hardcoded chain list in a codebase whose stated doctrine is config-as-data (Xendit channels, tokens, contracts, chain RPC routes are all DB rows).

### 1.2 Removing it is safe for the published app

- No client sends the param.
- Response shape of `GET /blockchains` is unchanged without it.
- The global `ValidationPipe` (`src/main.ts`) has `forbidNonWhitelisted: false`, so a stray `?country=` from any client is ignored, not rejected as 400.

A full removal was implemented and reverted on 2026-09-19 to keep that session in scope. It touched: the constant, `resolveCountryAllowlist`, the env override, `GetBlockchainsQueryDto` (deleted), the controller `@Query()` param, the `countrySegment` argument on `BlockchainCacheService.getEnrichedConfig`, the now-unused `ConfigService`/`Logger` injections in `BlockchainsService`, three spec tests, and a comment in `merchants/dto/list-channels-query.dto.ts` that cited it as precedent. `tsc` clean, `blockchains.service.spec.ts` passed. ~15 minutes to redo.

## 2. What actually gates a payment or deposit today

Nothing country- or region-shaped. Verified against the code, both sides.

**Server — point deposit intake** (`points.service.ts`, all fresh Prisma reads, no Valkey on this path):

1. `Token.isActive && Token.isStablecoin`
2. `Token.isPaymentEnabled` — "the ops switch", enforced server-side
3. `Blockchain.isActive`
4. A `SmartContract` row on that `blockchainId` with matching `address` (case-insensitive), `isActive`

**Server — merchant payment** (`pay/intents.service.ts`, `POST /pay/intents`): token must be `isPaymentEnabled`, chain must have an active `takumi_pay` contract, plus rail/x402 availability. No region.

**Mobile — before it lets the user proceed** (`hooks/deposit/useDepositState.ts` → `depositSupport.ts`):

1. wallet kit `supportsPointDeposit(chain)` (EVM / Stellar)
2. `/blockchains` contains a row matching the active chain
3. `/smart-contracts/chain/:chainId` returns a `payment` row
4. `/tokens/search?blockchainId=…&isStablecoin=true&isActive=true&isPaymentEnabled=true` returns ≥ 1 token with `peggedCurrency` and `contractAddress`

So the *only* lever ops has today for "this token is / isn't payable" is `Token.isPaymentEnabled`, and it is global — not per country.

## 3. The regional model already exists in the schema, unused

| Piece | Purpose | State on the remote DB (2026-09-19) |
|---|---|---|
| `Region` (`code`, `name`, `currencyCode`, `isActive`, `hasKYCRequirement`, `taxRate`, support contacts) | jurisdiction | 2 rows: `ID`, `SG` |
| `RegionAvailableToken` (`regionId`, `tokenId`, `isActive`, `minAmount`, `maxAmount`, `processingFee`, `networkFeeEstimate`, `isDefault`, `regulatoryNotes`) | which tokens a region may use, with limits | **0 rows** |
| Admin CRUD `POST/GET/PATCH/DELETE /regions/:id/tokens` (`src/regions/`) | ops UI for the above | exists, works |
| `User.regionId` (nullable) | the payer's region | **34 of 36 users are `NULL`** |
| `Token.regionAvailability` include in `tokens.service.ts` | already joined into token responses | present, nothing reads it |

This is the correct shape for what the allowlist was pretending to do. Gating by **token** per region also subsumes gating by **chain**: a `Token` row is already chain-specific, so a chain-level list becomes redundant.

## 4. If enforcement is added — constraints that decide whether the Play Store build breaks

### 4.1 The shipped app does deposits chain-first, API-second

`useDepositState.ts` lines ~640–703, in order:

1. `approve` (ERC-20) on-chain, wait for receipt
2. `depositPoints` on the `takumi_pay` contract, get `txHash`
3. **only then** `POST` intake to the API with `{ refId, txHash, tokenId, blockchainId, … }`

Any new rejection at intake (step 3) leaves the user's tokens inside the contract with no `PointTransaction`. That is not an error message — it is stranded funds. `points.service.ts` already documents this hazard for `isPaymentEnabled` ("Intake only — the processor deliberately does NOT re-check it, so a deposit already sent on-chain still credits if ops flips the flag while it is in flight").

### 4.2 The old build's pre-chain calls are unauthenticated

| Call | Client | Auth | Server can know the user's region? |
|---|---|---|---|
| `GET /tokens/search` (token picker) | `publicApi` | `X-API-Key` only, no JWT | **No** |
| `GET /points/price` (quote) | `publicApi` | `X-API-Key` only, `@Public()` | **No** |
| `POST /points/deposit` (intake) | `api` | JWT | Yes — but it's after the chain (§4.1) |
| `POST /pay/intents` (merchant payment) | `api` | JWT | Yes — and it's **before** the chain (it returns the `quoteSignature` the app needs) |

### 4.3 What follows

- **Merchant payments: per-user-region gating is safe now**, for old and new builds. Reject at `POST /pay/intents`; the old app already surfaces that 400 and nothing has moved on-chain.
- **Point deposits: the only pre-chain stop the old build honours is a per-token 400 from `/points/price`.** When that endpoint errors, `tokenAmountNeeded` is `null` (`useDepositState.ts` ~line 292) and the deposit function bails (~line 432) before signing. That is exactly what `Token.isPaymentEnabled` already does — the old build cannot be region-gated any finer than per-token.
- **Per-user-region deposit gating needs a new mobile release** that sends the JWT (or a `regionId`) on `/tokens/search` and `/points/price`. Until that build dominates, intake for old clients must **accept and credit** deposits the region rules would now refuse — never reject — or funds strand.
- **`User.regionId = NULL` must mean "unrestricted"**, not "reject". Otherwise 34/36 users are locked out the moment enforcement deploys.
- **Seed `RegionAvailableToken` for everything live today** (ID → Arc USDC, Monad AUSD, IDRX where enabled, …) *before* any enforcement ships, so nothing currently visible becomes refusable.
- **Keep `Token.isPaymentEnabled` as the global kill switch.** The store build's picker filters on it and the server enforces it; region rows should *narrow* it, never replace it.

## 5. Recommendation

1. Delete the hardcoded allowlist (§1.2). Zero user impact, removes a misleading comment that cost real debugging time.
2. Enforce `RegionAvailableToken` on `POST /pay/intents` only (safe for all builds), with `regionId = NULL` → unrestricted.
3. Seed region rows for current tokens; wire ops to `/regions/:id/tokens`.
4. Ship a mobile release that authenticates `/tokens/search` and `/points/price` (or passes `regionId`), and have those endpoints filter/refuse by region when they can identify the user.
5. Only after (4) is the dominant install: enforce on deposit intake — and even then, prefer "accept + flag for review" over "reject" for any deposit whose on-chain tx already exists.

Steps 1–3 are small and independent. Step 5 is the only one with real risk and should be its own task with its own rollout gate.

## 6. Open questions for product

- Is gating by *token* per region sufficient, or is there a real need to gate by *chain* independent of token? (Today's answer appears to be no — every payable token is chain-specific.)
- Where does a user's region come from at signup? `User.regionId` is nullable and only two rows in the DB have it set. Without a source of truth for region, per-user gating has nothing to key on.
- Should `RegionAvailableToken.minAmount / maxAmount` be enforced at the same time, and on which surface (quote vs. intake)?
