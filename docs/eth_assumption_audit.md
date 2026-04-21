# ETH / 18-Decimals Assumption Audit — `takumipay-api`

**Task:** Task 33 — Backend ETH assumption audit (milestone M3)
**Spec refs:** `umkm-usdc-payout-spec.md` §7.1 ChainConfig, §5.1 USDC-as-native on Arc
**Scope:** `takumipay-api/src/**` — Prisma schema / blockchains / tokens / payout / pay / blockchain-verification / transactions / booking / points / valkey caches / seed.

## Summary

One-paragraph summary: grep of `takumipay-api/src/` surfaced **20 raw hits** on `"ETH"` / `decimals: 18` / `wei` / `1e18` patterns. After triage, **1 hit is Needs-fix (fixed)**, **17 are Safe** (chain-specific constants for Ethereum-family rows, internal fixed-point math scaling, swagger doc examples, or seed/test fixtures), and **2 are Deferred** doc-example comments in DTO swagger metadata that don't affect runtime behaviour but should be neutralised when Arc ships to production. `pnpm run build` passes. Full test suite: **187/187 tests pass**; one pre-existing unrelated suite failure (`merchants.controller.spec.ts`, `jwt-auth.guard.ts` path-alias issue) is not introduced by this audit.

## Schema reality check

- `Blockchain` model has **no** `nativeCurrencyDecimals` or `nativeCurrencySymbol` column. Native-currency metadata lives on the related `Token` row where `isNativeCurrency = true` (`decimals: Int`, `symbol: String`). Consumers should read `blockchain.tokens.find(t => t.isNativeCurrency).decimals`.
- The enriched `GET /v1/blockchains` endpoint already surfaces `nativeCurrency.{symbol,decimals,address}` correctly via `blockchain-enricher.ts::buildNativeCurrency`, which reads from the Token row. Mobile (`useBlockchains()` per §6.7) consumes the row value.
- Arc Testnet (chainId 5042002) is seeded with `symbol: "USDC", decimals: 6, isNativeCurrency: true, isStablecoin: true` on the same Token row — the one place the dual-native/stablecoin status lives.

## Audit table

| File | Line | Hit | Classification | Fix status |
|---|---|---|---|---|
| `src/blockchain-verification/blockchain-verification.service.ts` | 80 | `decimals: nativeToken?.decimals \|\| 18` — silent fallback to 18 decimals if native Token row missing | **Needs fix** | **Fixed** — replaced fallback with explicit skip-and-warn when native Token row is absent; reads `nativeToken.decimals` directly from DB row. |
| `src/blockchain-verification/blockchain-verification.service.ts` | 116 (was) | log message used `nativeToken?.symbol \|\| "NATIVE"` fallback | **Needs fix (cosmetic)** | **Fixed** — log now cites actual symbol + decimals from DB row (paired with the line-80 fix). |
| `src/scripts/prisma/seed.ts` | 940, 984, 1007, 1029, 1052 | `symbol: "ETH"` with `decimals: 18` on Ethereum/Base/Sepolia/Lisk/Arbitrum native Token rows | **Safe** | Seed data correct for each chain; Arc (line 1125) correctly seeded as `USDC`/6. |
| `src/scripts/prisma/seed.ts` | 963 | `symbol: "MATIC", decimals: 18` on Polygon | **Safe** | Correct for Polygon mainnet. |
| `src/scripts/prisma/seed.ts` | 1074, 1096 | `symbol: "SOL", decimals: 9` on Solana | **Safe** | Non-EVM; off-path for this audit. |
| `src/scripts/prisma/seed.ts` | 1107–1113 | comment explaining Arc's `decimals = 6` is the ERC-20 interface view; "18-decimal native gas view only matters on estimateGas paths" | **Safe** | Correct design commentary; no code affected. |
| `src/scripts/prisma/seed.ts` | 1745 | `fromCurrency: "ETH"` on a seeded exchange rate row | **Safe** | Historical fixture for an Ethereum-family purchase; not used on Arc path. |
| `src/valkey/services/cache-warming.service.ts` | 114, 115 | `{ from: 'ETH', to: 'USD' }` and `{ from: 'ETH', to: 'IDR' }` in popular-pairs warm list | **Safe** | Ethereum FX pairs — legitimate asset pricing; Arc USDC pricing is seeded as `USDC→IDR` via a separate pair (task 26). |
| `src/blockchains/blockchain-enricher.ts` | 128 | doc-comment: "For chains whose native is a true native (ETH), contractAddress is null" | **Safe** | Documentation; describes the two-mode design. |
| `src/blockchains/blockchain-enricher.spec.ts` | 198–217 | test fixture with `symbol: "ETH", decimals: 18` on an Ethereum-row | **Safe** | Test fixture for the Ethereum-native scenario; Arc coverage exists in the same file. |
| `src/blockchains/dto/enriched-blockchain-response.dto.ts` | 92 | swagger description: "Null when the native currency is a true native (e.g. ETH)" | **Safe** | Docstring; accurate. |
| `src/pay/intents.service.ts` | 1035, 1036, 1037, 1042, 1048, 1073, 1074, 1078 | `10n ** 18n` and `parseDecimalToScaled(x, 18)` | **Safe** | Internal fixed-point math precision for FX-rate × markup composition; **not** a token-decimals assumption. The `1_000_000n` constant (line 1048) correctly encodes USDC 6-decimal atomic units. |
| `src/booking/booking.service.ts` | 162 | `Math.pow(10, token.decimals)` | **Safe** | Reads `token.decimals` from DB — correct. |
| `src/points/processors/point-deposit.processor.ts` | 93 | `new Prisma.Decimal(10).pow(token.decimals)` | **Safe** | Reads `token.decimals` from DB — correct. |
| `src/transactions/transactions.service.ts` | 205, 329 | selects `decimals: true` on Token relation | **Safe** | Passes through DB decimals in response — correct. |
| `src/transactions/dto/create-transaction.dto.ts` | 27 | swagger example `"1000000000000000000"` with description `"Amount in raw token units (e.g., wei)"` | **Deferred** | Doc-only; example is 1e18 which implies an 18-decimal chain. No runtime code reads this comment. Consider updating to a chain-agnostic example when Arc cuts over to mainnet (task 48). |
| `src/blockchain-verification/dto/transaction-verification.dto.ts` | 121 | swagger description `"Transaction value in wei"` on `value` field | **Deferred** | On EVM chains (including Arc), the raw `tx.value` field IS in 18-decimal wei regardless of the ERC-20 native interface view. Accurate description for EVM verification; could be clarified as "native units (18-decimal wei on EVM)". No runtime behaviour affected. |
| `src/valkey/services/token-cache.service.ts` | 21 | `TOKEN_LIST: 1800` | **Safe** (false-positive on `18`) | TTL constant. |
| `src/valkey/services/product-cache.service.ts` | 22 | `PRODUCT_LIST: 1800` | **Safe** (false-positive on `18`) | TTL constant. |
| `src/valkey/services/booking-cache.service.ts` | 24 | `USER_BOOKINGS: 180` | **Safe** (false-positive on `18`) | TTL constant. |

## Fix detail

### `src/blockchain-verification/blockchain-verification.service.ts` (line 80 area)

**Before:**
```ts
const nativeToken = blockchain.tokens.find((token) => token.isNativeCurrency);

const dynamicChain: Chain = {
  id: blockchain.chainId,
  name: blockchain.name,
  nativeCurrency: {
    name: nativeToken?.name || "Native Token",
    symbol: nativeToken?.symbol || "NATIVE",
    decimals: nativeToken?.decimals || 18,   // <-- hardcoded 18-decimal fallback
  },
  …
};
```

**After:**
```ts
const nativeToken = blockchain.tokens.find((token) => token.isNativeCurrency);

if (!nativeToken) {
  this.logger.warn(
    `Skipping chain ${blockchain.name} (chainId=${blockchain.chainId}): ` +
    `no active native-currency token row found; native decimals unknown.`,
  );
  continue;
}

const dynamicChain: Chain = {
  id: blockchain.chainId,
  name: blockchain.name,
  nativeCurrency: {
    name: nativeToken.name,
    symbol: nativeToken.symbol,
    decimals: nativeToken.decimals,  // <-- always from DB Token row
  },
  …
};
```

**Why it matters:** On Arc the native Token row is seeded with `decimals: 6` (USDC-as-native). If seeding were ever incomplete, the previous `|| 18` fallback would silently register Arc with 18-decimal viem formatters — exactly the "Balance-formatting utilities hardcoding `decimals: 18` for EVM natives" failure mode called out in §7.1. Skipping-with-warn makes the missing-seed condition loud instead of silently wrong. In the happy path (native Token row present) behaviour is unchanged because `nativeToken.decimals` was already the primary source.

**Chain-extension discipline:** fix reads from DB Token row (never introduces an `if (chainId === 5042002)` branch). Consumers still resolve native metadata via the same path as the enriched `/v1/blockchains` endpoint (§6.7).

## Verification

- `pnpm run build` — clean. Nest build succeeds with no type errors.
- `pnpm run test` — 187/187 tests pass. 1 suite failure (`merchants.controller.spec.ts`) is pre-existing — it fails with `Cannot find module 'src/decorators/public.decorator' from 'auth/guards/jwt-auth.guard.ts'`, a Jest `moduleDirectories` / path-alias config issue. Reproduced on the unmodified codebase via `git stash` → same failure → not caused by this audit. Recommend filing a separate ticket.
- Post-fix grep re-run confirms zero `(b)` / Needs-fix hits remain. All remaining `"ETH"` / `18` hits are Safe or Deferred per the table above.

## Out-of-scope / follow-ups

- `src/transactions/dto/create-transaction.dto.ts` line 27 and `src/blockchain-verification/dto/transaction-verification.dto.ts` line 121 — swagger example/description strings that hint 18-decimal wei. Deferred, no behaviour impact. Update when Arc promotes to mainnet (task 48).
- Pre-existing `merchants.controller.spec.ts` path-alias resolution failure — not in scope for Task 33.
