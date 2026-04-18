# Task 06 — `SiwsService` — parse + ed25519 verify via `@solana/kit`

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `SIWS_SPEC.md` §3.5

## Why this matters

This is the crypto boundary of SIWS. `SiwsService.verify` owns: parse,
domain check, expiry check, signature decode, pubkey decode, Web Crypto
Ed25519 verification, and nonce consumption. Everything upstream
(`AuthService.verifySignature` dispatcher, task 07) trusts this
service's boolean. Getting any step wrong either locks out legitimate
users or creates a bypass.

## Scope

Create `src/auth/siws/siws.service.ts`:

```ts
@Injectable()
export class SiwsService {
  constructor(
    private readonly nonceCache: NonceCacheService,
    private readonly config: ConfigService,
  ) {}

  buildMessage(input: SiwsPayload): string;          // delegates to buildSiwsMessage (task 05)
  parseMessage(message: string): SiwsPayload;        // delegates to parseSiwsMessage

  async verify(message: string, signature: string): Promise<{
    success: boolean;
    address: string;        // base58
    domain: string;
    nonce: string;
    chainId: string;        // "mainnet" | "devnet"
  }>;
}
```

`verify` steps (**in this order**):

1. `parseMessage` → extract `address`, `domain`, `nonce`, `chainId`,
   `issuedAt`, `expirationTime`.
2. Assert `domain === SIWE_DOMAIN` (reuse env var). Mismatch → reject.
3. Assert `Date.now() < Date.parse(expirationTime)`. SIWS enforces its
   own expiry in the signed bytes, independent of the Valkey TTL.
4. Decode signature — try base58 first, fall back to base64. Assert
   exactly 64 bytes. Brand as `SignatureBytes` from `@solana/keys`.
5. Encode the base58 address via
   `getAddressEncoder().encode(address as Address)`. Require 32-byte
   output; reject otherwise.
6. `webcrypto.subtle.importKey("raw", pubkeyBytes, { name: "Ed25519" }, false, ["verify"])`.
7. `await verifySignature(pubKey, signatureBytes, new TextEncoder().encode(message))`.
8. Load nonce from `NonceCacheService.getNonce("solana", address)`;
   assert equality with parsed `nonce`; delete on success
   (`deleteNonce("solana", address)`).

## Rules (non-negotiable)

- **Use `@solana/keys` + `@solana/addresses`** (task 04). Do not
  introduce `@noble/curves`, `tweetnacl`, or any other ed25519
  primitive — one crypto path.
- **Use `node:crypto` `webcrypto.subtle` directly.** No polyfill.
- **Signature decode order is base58 → base64 → reject.** Matching
  spec §3.3; hex is not accepted.
- **Nonce is consumed exactly once.** Successful verify deletes;
  failed verify leaves it (client may retry within TTL).
- **Fail closed.** Any exception in parse/decode/verify returns
  `{ success: false }` — never throws up to the controller. The dispatch
  layer (task 07) turns that into a 401.
- **No DB writes.** `SiwsService` does not touch Prisma. User upsert is
  `AuthService.login`'s job (task 08).

## Acceptance

- [ ] `SiwsService` is DI-wired, injectable into `AuthService`.
- [ ] All 8 verify steps are present and ordered as above.
- [ ] Unit test with a `@solana/kit` `generateKeyPairSigner` →
      `signBytes` → `SiwsService.verify` round-trip returns
      `{ success: true, ... }`.
- [ ] Negative tests: wrong nonce, expired message, domain mismatch,
      malformed base58, 63-byte sig, missing `Expiration Time`.
- [ ] Nonce is deleted on success; left intact on failure.
- [ ] `SiwsService` does not import Prisma.

## Out of scope

- Controller wiring (task 10).
- Dispatch between SIWE and SIWS in `AuthService` (task 07).
- Integration test of the full HTTP round-trip (task 15).
