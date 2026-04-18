# SIWS (Sign-In with Solana) — TakumiPay API Spec

Status: Draft
Owner: API team
Scope: `takumipay-api` auth module + mobile app `auth.tsx` sign flow.
Related: existing SIWE flow (`src/auth/auth.service.ts`), Solana blockchain seeds (`src/scripts/prisma/seed.ts`), mobile SIWS builder (`mobile-app/services/chains/solana/siws.ts`).

---

## 1. Goal

Let users sign in to the TakumiPay API with a Solana wallet using Sign-In with Solana (SIWS), mirroring the existing SIWE flow. Both flows must:

- Issue the **same** JWT + refresh-token pair (`AuthResponseDto`).
- Create/lookup the **same** `User` row (one user = one wallet identity, regardless of chain family).
- Share nonce storage, expiry rules, and replay-protection semantics.
- Coexist on the same `/auth/nonce/:address` + `/auth/verify` endpoints — we do **not** add `/auth/nonce-solana` etc.

Out of scope: linking multiple wallets to one user (tracked separately), delegated/session keys, cross-chain signature aggregation.

---

## 2. Current State

### 2.1 Backend (what exists)

- `auth.controller.ts:38-50` — `GET /auth/nonce/:walletAddress?chainId=<int>` returns `{ nonce, message }`.
- `auth.controller.ts:58-77` — `POST /auth/verify { message, signature }`; extracts address via `/0x[a-fA-F0-9]{40}/i` regex, calls `login(address)`.
- `auth.service.ts:49-82` — `createSiweMessage` hard-rejects any non-`0x...` with `BadRequestException`.
- `auth.service.ts:84-111` — `verifySignature` uses `SiweMessage.verify({ signature })` (viem/ethers-style EIP-191).
- `auth.service.ts:113-160` — `login` upserts `User` by `walletAddress.toLowerCase()`.
- `prisma/schema.prisma:101` — `User.walletAddress String? @unique` (single column, lowercased by convention).
- `prisma/schema.prisma:136-152` — `Blockchain.isEVM`, `chainId Int?`, `chainSlug String?` — **already chain-agnostic**. Solana rows exist: `chainSlug="solana-mainnet"`, `"solana-devnet"`, `isEVM=false`.
- `valkey/services/nonce-cache.service.ts` — key is `nonce:${walletAddress.toLowerCase()}`, TTL from `NONCE_EXPIRE_TIME_MINUTES` (default 5).
- `.env.example` — `SIWE_DOMAIN="com.cstralpt.takumipay"`, `SIWE_URI="takumipay://wallet-auth"`, `SIWE_STATEMENT`, `CHAIN_ID=1`.

### 2.2 Mobile (what exists)

- `services/chains/solana/siws.ts` — canonical SIWS message builder (Phantom reference). Fields: `domain, address, statement, uri, version, chainId (cluster: "mainnet"|"devnet"|"testnet"), nonce, issuedAt, expirationTime, notBefore, requestId, resources`. Line endings are `\n`; CRLF rejected; `expirationTime ≤ issuedAt` rejected (code `-32602`).
- `constants/types/walletTypes.ts` — `TWallet.namespace: "eip155" | "solana" | "sui"`, `TWallet.address` holds base58 pubkey for Solana, `TSolanaFields.pubkeyBase58`.
- `app/auth.tsx:124-128` — sign path hardcodes `walletClient.signMessage({ account, message })` (EVM-only via viem).
- `hooks/queries/useAuth.ts:135-155` — `useNonce(walletAddress, chainId)` hits `auth/nonce/${walletAddress}?chainId=${chainId}`; `chainId` is numeric today.
- `services/walletKit` — Solana signer produces ed25519 signatures over arbitrary message bytes (Wallet-Standard `solana:signMessage` semantics).

### 2.3 Gaps that block SIWS

1. `User.walletAddress` is lowercased on write + on lookup. **Solana base58 is case-sensitive** — `.toLowerCase()` corrupts the pubkey and breaks signature-to-identity mapping.
2. Nonce cache key uses `.toLowerCase()` — same problem.
3. `auth.controller.ts:68` extracts address via a regex that only matches EVM hex.
4. `createSiweMessage` (service) rejects any non-EVM address upfront.
5. `NonceDto.chainId` is `@IsNumber()` — Solana needs a cluster string (`"mainnet"`/`"devnet"`) or we key on `chainSlug`.
6. No ed25519 verifier on the backend.

---

## 3. Design

### 3.1 Identity model

We keep `User.walletAddress` as the single wallet-identity column. To fix case handling without per-chain schema churn:

- **Stop lowercasing at the boundary.** Store the address as the wallet emitted it. Add a `User.walletAddressLower` generated/normalized column for case-insensitive EVM lookups (EVM is still case-insensitive; Solana we match as-is).
- Indexing: `@@unique([walletAddressLower])` for EVM lookups; keep `@@unique([walletAddress])` for exact-match (Solana).

Alternative (rejected): adding a `chainNamespace` discriminator column. It forces every caller that references a user by wallet to also know the chain, which is invasive and not required for MVP. SIWS signatures cryptographically prove control of the base58 pubkey; address uniqueness across the entire column is sufficient because EVM hex and Solana base58 collide with probability ≈ 0.

**Migration:**
```sql
ALTER TABLE "User" ADD COLUMN "walletAddressLower" TEXT;
UPDATE "User" SET "walletAddressLower" = LOWER("walletAddress") WHERE "walletAddress" IS NOT NULL;
CREATE UNIQUE INDEX "User_walletAddressLower_key" ON "User"("walletAddressLower");
```
Application writes both columns atomically inside `login()`.

### 3.2 Nonce keying

Nonce key becomes chain-namespace-aware:

```
nonce:<namespace>:<address-as-submitted>
```

Where `<namespace>` is `eip155` | `solana`. EVM path lowercases the address segment to preserve today's semantics (no behaviour change for existing clients); Solana path uses the base58 address verbatim.

Helper: `NonceCacheService.buildKey(namespace, address)` — single function both set/get/delete go through.

### 3.3 Endpoints

**No new endpoints.** The existing pair is extended:

#### `GET /auth/nonce/:walletAddress`

Query params:
- `chainId?: number` — EVM chain id. Mutually exclusive with `chainSlug`.
- `chainSlug?: string` — non-EVM slug (`"solana-mainnet"` | `"solana-devnet"`). Required for SIWS.

Server infers namespace from which param is present:
- `chainId` set → EVM → builds SIWE message (unchanged behavior).
- `chainSlug` starts with `solana-` → Solana → builds SIWS message via `buildSiwsMessage`.
- Neither set → defaults to EVM with `CHAIN_ID` env (unchanged).
- Both set → `400`.

Response (shape unchanged):
```json
{ "nonce": "<hex>", "message": "<canonical SIWS or SIWE string>" }
```

The Solana `message` is **exactly** the output of the mobile `buildSiwsMessage` — byte-for-byte identical, because both sides must sign/verify the same bytes. The canonical builder moves into a shared util the backend imports (see §3.5).

#### `POST /auth/verify`

Body (shape unchanged):
```json
{ "message": "<SIWE or SIWS>", "signature": "<hex | base58>" }
```

Server detects which protocol:
- Message starts with `<domain> wants you to sign in with your Ethereum account:` → SIWE path (today's behavior).
- Message starts with `<domain> wants you to sign in with your Solana account:` → SIWS path.
- Anything else → `401 Invalid message`.

Signature encoding:
- SIWE: `0x`-prefixed hex (unchanged).
- SIWS: base58 (Wallet-Standard returns base58 sig bytes). Accept base64 as a fallback — the Phantom spec uses base58 on the wire but some adapters emit base64; we try base58 first, fall back to base64, else reject.

Response: unchanged `AuthResponseDto`.

### 3.4 SIWS message format (server-side canonical)

Identical to `mobile-app/services/chains/solana/siws.ts`. Fields the server populates:

| Field | Value |
|---|---|
| `domain` | `SIWE_DOMAIN` env (reused — same relying party) |
| `address` | base58 pubkey from URL param |
| `statement` | `SIWE_STATEMENT` env (reused) |
| `uri` | `SIWE_URI` env (reused) |
| `version` | `"1"` |
| `chainId` | `"mainnet"` or `"devnet"` (derived from `chainSlug`: `solana-mainnet` → `mainnet`) |
| `nonce` | 32-byte hex from `randomBytes(32).toString("hex")` (same as SIWE) |
| `issuedAt` | `new Date().toISOString()` |
| `expirationTime` | `issuedAt + NONCE_EXPIRE_TIME_MINUTES` — **must** match nonce TTL so server-side replay window ≡ signed window |
| `notBefore`, `requestId`, `resources` | omitted |

The header MUST read `"<domain> wants you to sign in with your Solana account:"` exactly. Any deviation causes signature mismatch on the verifier.

### 3.5 Verification

**Library choice: `@solana/kit`** (plus `@solana/addresses`), not `@noble/curves`. Rationale:
- The mobile app already signs with `@solana/kit` (`KeyPairSigner.signMessages` inside `services/chains/solana/signer.ts`). Using the same library server-side keeps encoding assumptions symmetric (`SignatureBytes`, `Address` types, base58 semantics, offchain-message header handling) and eliminates a class of "signs on mobile, verifies wrong on server" bugs.
- `@solana/kit` works natively on Node.js ≥ 16.9, which has Web Crypto Ed25519 built in. **No polyfill required** on our runtime (Node 20+). We do *not* install `@solana/webcrypto-ed25519-polyfill`.
- No third-party crypto dependency beyond what the Solana ecosystem already ships.

Caveat: `@solana/kit` has no first-class "verify SIWS" helper ([anza-xyz/kit#33](https://github.com/anza-xyz/kit/issues/33) was closed as not-planned). We wire the primitives together ourselves — ~15 lines.

New file `src/auth/siws/siws.service.ts`:

```ts
import { verifySignature, type SignatureBytes } from "@solana/keys";
import { getAddressEncoder, type Address } from "@solana/addresses";
import { webcrypto } from "node:crypto";

@Injectable()
export class SiwsService {
  buildMessage(input: SiwsPayload): string;          // mirrors mobile buildSiwsMessage
  parseMessage(message: string): SiwsPayload;        // tolerant parse
  async verify(message: string, signatureB58OrB64: string): Promise<{
    success: boolean;
    address: string;        // base58
    domain: string;
    nonce: string;
    chainId: string;        // "mainnet" | "devnet"
  }>;
}
```

`verify` steps:
1. Parse message → extract `address`, `domain`, `nonce`, `chainId`, `issuedAt`, `expirationTime`.
2. Assert `domain === SIWE_DOMAIN`.
3. Assert `Date.now() < Date.parse(expirationTime)` — SIWS enforces its own expiry in the signed bytes.
4. Decode signature (base58 primary, base64 fallback) → assert 64 bytes → brand as `SignatureBytes`.
5. Encode the base58 address to the 32-byte pubkey via `getAddressEncoder().encode(address as Address)`. Reject if length ≠ 32.
6. Import the pubkey into Web Crypto as an Ed25519 verify-only `CryptoKey`:
   ```ts
   const pubKey = await webcrypto.subtle.importKey(
     "raw",
     pubkeyBytes,
     { name: "Ed25519" },
     /* extractable */ false,
     ["verify"],
   );
   ```
7. Call `await verifySignature(pubKey, signatureBytes, new TextEncoder().encode(message))` — returns `boolean`. This is the same primitive the mobile side uses via its signer; the bytes over the wire are the UTF-8 of `message` exactly as `buildSiwsMessage` produced them.
8. Load nonce from Valkey via `NonceCacheService.buildKey("solana", address)`; assert equality; `deleteNonce` on success.

**Why not `@noble/curves/ed25519`**: equivalent cryptographically, but a separate crypto path from the mobile signer (`KeyPairSigner.signMessages` → Web Crypto Ed25519). Keeping one library on both sides means if Wallet-Standard / Phantom change encoding conventions later, we only track upstream changes in one place.

`AuthService.verifySignature(message, signature)` becomes a dispatcher:

```ts
if (message.includes("wants you to sign in with your Solana account:")) {
  return this.siwsService.verify(message, signature);
}
// existing SIWE path
```

`AuthService.login(address, namespace)` — add namespace param so the upsert can write:
- `walletAddress: address` (verbatim)
- `walletAddressLower: namespace === "eip155" ? address.toLowerCase() : address`

Lookup path: `findUnique({ where: { walletAddressLower: inputLower } })` where `inputLower = namespace === "eip155" ? address.toLowerCase() : address`.

### 3.6 JWT contents

No shape change. `payload.walletAddress` carries the address in its native canonical form (lowercase for EVM, base58 for Solana). Existing consumers that compare with `.toLowerCase()` will continue to work for EVM; new Solana consumers compare verbatim.

Optionally we add `payload.addressNamespace: "eip155" | "solana"` to make downstream code explicit. **Recommended** — cheap to add, avoids ambiguous string inspection later.

### 3.7 Mobile integration

Changes in `mobile-app`:

1. `hooks/queries/useAuth.ts:135-155` — `useNonce(address, opts: { chainId?: number; chainSlug?: string })`. Caller passes `chainSlug` when `activeWallet.namespace === "solana"`.
2. `app/auth.tsx`:
   - Replace `getEvmChainId(activeChain)` usage with a branch on `activeWallet.namespace`.
   - When namespace is `solana`: call `useNonce(address, { chainSlug: "solana-mainnet" | "solana-devnet" })`, then sign via the Solana kit signer (`services/chains/solana/signer.ts`'s `signMessage` path — which already wraps `KeyPairSigner.signMessages`). Signature bytes are base58-encoded before POST.
   - When namespace is `eip155`: existing path unchanged.
3. `useVerifySignature` body unchanged — already passes `{ message, signature }`.

No changes needed to `siws.ts` itself — the builder is already canonical.

---

## 4. Security Considerations

- **Replay protection**: nonce is single-use; deleted atomically on successful verify. SIWS `expirationTime` must equal the Valkey TTL so a valid-looking message can't be cached and replayed past nonce eviction.
- **Domain binding**: `domain` inside the signed message MUST match `SIWE_DOMAIN`. Mismatch → reject. Prevents a malicious dApp from requesting an SIWS the user thinks is for a different site.
- **Expiration**: SIWS messages include `expirationTime`; SIWE does not by default. Server enforces both the signed `expirationTime` AND the Valkey nonce TTL — whichever expires first wins.
- **Signature malleability**: Ed25519 signatures are non-malleable; we do not need EVM's `s`-value normalization. Reject signatures that deserialize to anything other than exactly 64 bytes.
- **Pubkey validation**: Decode base58 → require exactly 32 bytes. Reject addresses on the ed25519 curve's torsion subgroup? Not required by SIWS/Phantom reference; skip.
- **Case-sensitivity bug class**: explicitly audit every downstream consumer of `User.walletAddress` before deploy. Search list:
  - `src/blockchain-verification/**` — verifies against sender; must not lowercase Solana addresses.
  - `src/nft/**` — stores `walletAddress` per-chain; already per-blockchain composite.
  - `src/points/**`, `src/booking/**`, `src/purchases/**` — token transfers are EVM-only today, so no immediate exposure, but audit pending.

---

## 5. Migration & Rollout

1. **DB migration** — add `walletAddressLower` column + backfill + unique index (§3.1).
2. **Backend code** — add `SiwsService`, extend `NonceDto` with `chainSlug`, dispatch in `verifySignature`, thread namespace through `login`.
3. **Deps**: add `@solana/keys` + `@solana/addresses` (both from `@solana/kit`; ~small, matches the mobile dep set). Use Node.js built-in `node:crypto` `webcrypto.subtle` — no polyfill, no separate ed25519 library. Node runtime must be ≥ 20 (current target).
4. **Mobile code** — namespace-aware nonce query + sign path in `app/auth.tsx`.
5. **Deploy order**: DB migration → API → mobile. API must accept both old (chainId-only) and new (chainSlug) requests throughout the mobile rollout window.
6. **Feature flag**: none needed — the endpoint is additive. If things go wrong, mobile keeps hitting EVM path.

---

## 6. Test Plan

- Unit: `SiwsService.buildMessage` produces byte-identical output to `mobile-app/services/chains/solana/siws.ts` (import that file's expected fixtures).
- Unit: `SiwsService.verify` — valid sig accepted; wrong nonce rejected; expired rejected; domain mismatch rejected; malformed base58 rejected; 63-byte sig rejected; pubkey off-curve accepted (matches Phantom reference).
- Integration: full round-trip using `@solana/kit` `KeyPairSigner` both sides — generate server-side keypair, `signBytes(privateKey, utf8(message))`, POST base58-encoded signature → `/auth/verify` → JWT issued. Confirms symmetry between `signBytes`/`verifySignature` across runtimes.
- Integration: existing SIWE flow remains green.
- E2E (mobile): both wallet namespaces authenticate; switching active wallet between chains issues correct per-wallet JWT.

---

## 7. Open Questions

1. **One user per wallet vs. one user per identity**: today EVM users get one row keyed by EVM address. If a user has both an EVM and a Solana wallet in the same app, do they become two separate `User` rows or one linked identity? MVP: two rows (simplest, matches existing behavior). Track linking as a follow-up.
2. **`chainId` inside JWT for Solana**: today `payload.walletAddress` is enough. Do downstream services need `payload.cluster = "mainnet"|"devnet"`? Probably no — most payment flows bind cluster via the transaction's `recentBlockhash`, not the auth token.
3. **Signature encoding**: spec says base58 primary, base64 fallback. Confirm with Wallet-Standard adapters we expect to integrate with — some emit hex.
