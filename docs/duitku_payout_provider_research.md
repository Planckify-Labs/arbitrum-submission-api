# Duitku Payout Provider — Integration Research

**Scope:** Extend `src/payout/` with a second provider (`duitku`) that slots into the existing space-docking port (`IPayoutProviderAdapter`), so `merchants.payoutProvider` can switch between `"xendit"` and `"duitku"` per merchant without touching callers.

**Primary use case:** disbursement / payout (IDR to bank account or e-wallet). Payment-gateway (inbound payments) is out-of-scope for this task but documented at the end for future optionality.

---

## 1. How the current space-docking port works

- **Port:** `src/payout/payout-provider.port.ts` — `IPayoutProviderAdapter` with three methods: `triggerPayout(intent, merchant)`, `getStatus(providerReferenceId)`, `verifyWebhookSignature(headers, body)`.
- **Factory:** `PayoutService.resolveProvider(key)` in `src/payout/payout.service.ts` — a single `switch` on `merchant.payoutProvider`. Adding a case here is the only branching allowed; no caller downstream ever checks the provider name (rule in the port header).
- **DI binding:** `src/payout/payout.module.ts` — each concrete adapter binds to its own token (`PAYOUT_PROVIDER_XENDIT` today). Adapters pull their own env via `ConfigService`, never `process.env`.
- **Persistence shape:** `XenditPayout` table (`prisma/schema.prisma:924`) — the table name and column names are Xendit-branded today but the row stores provider-agnostic fields (`referenceId`, `channelCode`, `accountNumberEncrypted`, `amount`, `currency`, `status`, `xenditResponseBody` for raw JSON). The adapter returns a `TPayoutReceipt` and `PayoutService.persistSuccess/persistFailure` writes the row. Reuse the same table; the provider name is implicit in `merchant.payoutProvider` on the linked intent.
- **Merchant fields** (`Merchant` model, `prisma/schema.prisma:834`): `xenditChannelCode`, `xenditAccountNumber` (Bytes, encrypted), `xenditAccountHolderName`. Duitku needs the same three inputs under different names, so we'll introduce provider-neutral aliases (see §6 below).
- **Webhook controller:** `src/payout/webhook.controller.ts` — currently hardcoded to `POST /webhooks/xendit` and `x-callback-token`. For Duitku we add a sibling endpoint `POST /webhooks/duitku` that uses the same persistence + state-machine logic, differing only in the verifier.

**Non-negotiable rules from the port header** (apply to Duitku too):
1. No `if (providerName === "xendit")` branches leak into callers. Only `resolveProvider` reads `merchant.payoutProvider`.
2. Adapters NEVER log the provider secret or the account number. Redact at the log boundary.
3. Adapters read their own env via `ConfigService`, never `process.env`.

---

## 2. Duitku disbursement API — summary

Source: https://docs.duitku.com/disbursement/en/ and https://docs.duitku.com/en/disbursement-feature/overview/. Duitku's legacy disbursement API is **not** the BI-SNAP standard — it's a JSON-body + SHA256-signature rail. (There is a separate SNAP-API product at `docs.duitku.com/snap-api/en/`; we do not need it for v1.)

### 2.1 Credentials

- `userId` — merchant integer id, issued by Duitku.
- `email` — the merchant's registered email (acts as a second identifier in every signature).
- `secretKey` — opaque HMAC-like shared secret, emailed by Duitku after disbursement activation. Treat like `XENDIT_SECRET_KEY`.
- IP allow-listing: Duitku requires our **egress IP** to be whitelisted, and our callback endpoint must be whitelisted too. Both are set via Duitku support (not self-service).

### 2.2 Base URLs

| Env | Online Transfer (RTOL/e-wallet) |
|---|---|
| Sandbox | `https://sandbox.duitku.com/webapi/api/disbursement/...sandbox` |
| Production | `https://passport.duitku.com/webapi/api/disbursement/...` |

There are also `/inquiryclearing[sandbox]` and `/transferclearing[sandbox]` paths for LLG/RTGS/BIFAST/H2H, and separate `disbursement.duitku.com` hosts for cash-out to Indomaret/Pos. v1 only targets **Online Transfer** (RTOL + e-wallets) — same product surface Xendit's `/v2/payouts` covers.

### 2.3 Endpoints we need

All are `POST`, `Content-Type: application/json`. No `Authorization` header; credentials and signature live in the body.

| Purpose | Path suffix | Port method it maps to |
|---|---|---|
| Inquiry (name lookup + balance check) | `/inquiry[sandbox]` | internal helper (step 1 of `triggerPayout`) |
| Transfer (debit merchant balance) | `/transfer[sandbox]` | step 2 of `triggerPayout` |
| Inquiry Status (reconcile) | `/inquirystatus` | `getStatus(providerReferenceId)` |
| Check Balance | `/checkbalance` | optional ops helper |
| List Bank | `/listBank` | optional seed helper for `Channel` table |

### 2.4 Signature formulas (SHA256 hex, lowercase, order-sensitive concat)

| Endpoint | Formula |
|---|---|
| Inquiry | `SHA256(email + timestamp + bankCode + bankAccount + amountTransfer + purpose + secretKey)` |
| Transfer | `SHA256(email + timestamp + bankCode + bankAccount + accountName + custRefNumber + amountTransfer + purpose + disburseId + secretKey)` |
| Inquiry Status | `SHA256(email + timestamp + disburseId + secretKey)` |
| Check Balance / List Bank | `SHA256(email + timestamp + secretKey)` |
| Clearing H2H callback | `SHA256(email + bankCode + bankAccount + accountName + custRefNumber + amountTransfer + disburseId + secretKey)` |

`timestamp` is Unix **milliseconds** (double). Server rejects if skew > 5 min (`-960`).

### 2.5 Transfer flow (the critical one)

Two-step — Xendit is one-step; we must model both internally and still expose a single `triggerPayout` from the port.

1. **Inquiry** → returns the beneficiary `accountName` (real owner name the bank reports), a Duitku-side `disburseId`, and validates we have enough balance. The response `accountName` **should be compared** to `merchant.xenditAccountHolderName` (our stored value) for safety; mismatch → abort with a client-error.
2. **Transfer** → sent with the `disburseId` + our `custRefNumber` (= intent id, same idempotency key Xendit already uses). Synchronous for RTOL/e-wallets: response carries the final state. For `H2H` clearing it returns `responseCode: "80" Waiting for Callback` and the final outcome lands on the callback.

For v1 (Online Transfer only), we can treat Transfer's 2xx response as terminal. No async callback is fired by Duitku for RTOL/e-wallet — reconciliation for edge cases (`68 Pending`, `TO Timeout`, `-100 Other`) uses `inquiryStatus`.

### 2.6 Response codes to handle

- `00` Success (terminal, funded) → map to `COMPLETED`.
- `80` Waiting for Callback (H2H only; not v1) → `PROCESSING`.
- `68` Time out / Pending → **do not retry**, wait T+1 then call `inquiryStatus`. Map to `PENDING` initially.
- `TO` Timeout from ATM Bersama → **do not retry**. Map to `PENDING`; needs ops reconcile.
- `-100` Other error → **do not retry**, contact support. Map to `FAILED` but flag in logs.
- `01` Failed (on callback) → `FAILED`.
- `-510` Insufficient merchant funds → `FAILED` + operational alert.
- `-191` Wrong signature, `-213` Invalid email, `-930` IP not whitelisted, `-960` Timestamp expired → adapter-config bugs, raise as `PayoutProviderError({ kind: "client_error" })`.
- `-141` Invalid amount, `-148` Bank doesn't support H2H, `-149` Bank not found, `-192` Blacklisted account, `-420` Transfer not found, `76` Invalid destination account → `kind: "client_error"` (terminal 4xx-equivalent).
- `-951` Vendor timeout, `-952` Invalid parameter, `-920` Limit exceeded → `kind: "server_error"` (retry-eligible only if not one of the "do not retry" set above).

**Critical retry rule:** For `TO`, `68`, `-100` the Duitku docs explicitly warn against retransmitting — retransmission can double-disburse. The adapter's retry loop MUST NOT retry these codes even though they are not 2xx. This is different from Xendit, where the adapter's retry discipline is purely HTTP-status-driven.

### 2.7 Channels

IDR only, integer major-units (rupiah). Same amount convention as Xendit. Per-transaction cap 50k–100M IDR depending on bank; e-wallets cap ~25M.

Channel code comparison:

| Channel | Xendit | Duitku |
|---|---|---|
| BCA | `BCA` | `014` |
| Mandiri | `MANDIRI` | `008` |
| BNI | `BNI` | `009` |
| BRI | `BRI` | `002` |
| CIMB Niaga | `CIMB` | `022` |
| Permata | `PERMATA` | `013` |
| BTPN/Jenius | `BTPN` | `213` |
| BSI | `BSI` | `451` |
| Jago | `JAGO` | `542` |
| OVO | `OVO` | `1010` |
| GoPay | `GOPAY` | `1011` |
| DANA | `DANA` | `1012` |
| ShopeePay | `SHOPEEPAY` | `1013` |
| LinkAja | `LINKAJA` | `1014` |

The Duitku `listBank` endpoint can seed the mapping at runtime. We will extend the existing `Channel` table with a nullable `duitkuChannelCode` column (see §6) so one `Channel` row maps to both providers.

### 2.8 Webhook / callback

- **Online Transfer has NO callback** — the Transfer HTTP response is terminal for RTOL/e-wallet. This means for v1 we will not expose a `POST /webhooks/duitku` endpoint; `verifyWebhookSignature` can be a stub that returns `false` (we never call it).
- If/when we add Clearing H2H or Cash-Out, the callback is `POST` JSON, verified via `SHA256(email + bankCode + bankAccount + accountName + custRefNumber + amountTransfer + disburseId + secretKey)` compared against the payload's `signature` field. No custom headers. Retries up to 5× on non-200.
- Callback IPs (for the firewall allow-list when we add it): Prod `182.23.85.{8,9,10,13,14}`, `103.177.101.{184,185,186,189,190}`; Sandbox `182.23.85.{11,12}`, `103.177.101.{187,188}`.

### 2.9 Sandbox test data

`userId=3551`, `email=[email protected]`, `secretKey=de56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d`. Bank-account suffix drives the mock response: `...66` → Success, `...11` → `TO`, `...62` → `-510` insufficient, `...64` → `68` pending.

---

## 3. Delta vs. the Xendit adapter

| Concern | Xendit (today) | Duitku (proposed) |
|---|---|---|
| Auth | HTTP Basic with `SECRET:` in the header | Payload-level `signature` per call (SHA256) |
| Flow | 1-step `POST /v2/payouts` | 2-step `inquiry` → `transfer` |
| Idempotency key | `Idempotency-key` header = `intent.id` | Body `custRefNumber` = `intent.id`; server rejects dupes with `-142 Transaction Already Finished` |
| Name validation | Merchant provides, not verified | Inquiry returns beneficiary `accountName` — compare to stored holder name before transferring |
| Callback | `POST /webhooks/xendit` with `x-callback-token` static shared secret | **None for RTOL/e-wallet**; reconcile via `inquiryStatus` polling on ambiguous codes |
| Retry discipline | HTTP-status-driven (5xx/timeout retry, 4xx terminal) | HTTP-status-driven AND response-code-driven (`TO`/`68`/`-100` → **NEVER retransmit**, escalate to `inquiryStatus`) |
| Secret material | `XENDIT_SECRET_KEY`, `XENDIT_WEBHOOK_TOKEN` | `DUITKU_DISB_USER_ID`, `DUITKU_DISB_EMAIL`, `DUITKU_DISB_SECRET_KEY` |
| Status reconcile | `getStatus` stubbed (webhook is source of truth) | `getStatus` **must be implemented** (`inquirystatus`) because it's the only way to resolve `68`/`TO` |
| Amount units | IDR integer (major units) | IDR integer (major units) — same |

---

## 4. Proposed implementation plan

### 4.1 Files to add

```
src/payout/providers/duitku-payout.provider.ts         # new IPayoutProviderAdapter impl
src/payout/providers/duitku-payout.provider.spec.ts    # parallel of xendit-payout.provider.spec.ts
src/payout/duitku-signature.ts                         # SHA256 helpers + a verifier
src/payout/duitku-signature.spec.ts                    # signature round-trip vectors
```

No new module — add the adapter + its injection token to the existing `PayoutModule`.

### 4.2 Files to edit

- `prisma/schema.prisma` — apply the provider-agnostic refactor (§6.1) and the Duitku additions in the same migration.
- `src/payout/payout-provider.port.ts` — add `PAYOUT_PROVIDER_DUITKU = Symbol("PAYOUT_PROVIDER_DUITKU")`.
- `src/payout/payout.module.ts` — register `DuitkuPayoutProvider` and bind the new token.
- `src/payout/payout.service.ts` — add `case "duitku": return this.duitkuProvider` to `resolveProvider`, inject the new token, and update `persistSuccess`/`persistFailure` to write `provider` and `providerResponseCode` onto `ProviderPayout`.
- Codemod — rename every `xendit*` Prisma accessor / type / relation to the provider-neutral name per §6.4 (mechanical, behaviour-preserving).
- `.env.example` — add Duitku env vars (`DUITKU_DISB_USER_ID`, `DUITKU_DISB_EMAIL`, `DUITKU_DISB_SECRET_KEY`, `DUITKU_DISB_API_BASE`).
- `src/scripts/prisma/seed.ts` — seed `ProviderChannel` rows for both `xendit` and `duitku` per channel (backfill in the migration covers existing data; seed keeps dev environments aligned going forward).
- DTO aliases (`@Expose({ name: "xenditChannelCode" })` or equivalent) — preserve outward JSON shapes for the first release; deprecate in a follow-up.

### 4.3 Adapter contract mapping

```ts
// DuitkuPayoutProvider implements IPayoutProviderAdapter

async triggerPayout(intent, merchant): Promise<TPayoutReceipt> {
  const { userId, email, secretKey, apiBase } = this.requireConfig();
  const accountNumber = decryptAccountNumber(merchant.duitkuAccountNumber ?? merchant.xenditAccountNumber);

  // 1. Inquiry — validates balance + resolves real account holder name.
  const inq = await this.postSigned(apiBase + "/inquiry", inquiryBody, inquirySig);
  assertInquiryOk(inq);
  assertHolderNameMatches(inq.accountName, merchant.xenditAccountHolderName);

  // 2. Transfer — uses the disburseId from inquiry; custRefNumber = intent.id.
  const tr = await this.postSigned(apiBase + "/transfer", transferBody, transferSig);
  return mapDuitkuResponseToReceipt(tr, intent, merchant);
}

async getStatus(providerReferenceId): Promise<TProviderStatus> {
  // disburseId polling — required for 68/TO reconcile.
  const res = await this.postSigned(apiBase + "/inquirystatus", { disburseId, userId, email, timestamp, signature });
  return mapDuitkuResponseCodeToStatus(res.responseCode);
}

verifyWebhookSignature(headers, body): boolean {
  // v1 RTOL has no callback — return false (never invoked).
  // When H2H/Cash-Out lands, verify SHA256 over payload fields per §2.4.
  return false;
}
```

### 4.4 Retry discipline (adapter-local)

Keep the existing Xendit-style exponential backoff (100ms × 4^attempt, MAX_ATTEMPTS=3) for **transport-layer** failures (5xx + timeout + network). Layer on top a **response-code filter** specific to Duitku: if the 2xx body carries `responseCode ∈ {"TO", "68", "-100"}`, short-circuit the retry loop and return a `PENDING` receipt with a flag that instructs `PayoutService` to enqueue a `getStatus` reconcile job. This is the only part that has no analogue in the Xendit adapter.

### 4.5 Signature construction

Build a single helper:

```ts
// src/payout/duitku-signature.ts
export function duitkuSha256(...parts: Array<string | number>): string {
  return createHash("sha256").update(parts.join(""), "utf8").digest("hex");
}
```

All five signature formulas collapse to ordered calls to this helper. Parameterize by a typed `DuitkuEndpoint` discriminator so signature fields track the endpoint.

### 4.6 Webhook controller

v1: no change. Online Transfer is callback-less.

Future (H2H/Cash-Out): add `POST /webhooks/duitku` to `webhook.controller.ts` mirroring `handleXenditCallback`, delegating verification to `DuitkuPayoutProvider.verifyWebhookSignature` (which reads the payload's `signature` field against the computed SHA256). Status mapping gets its own `mapDuitkuCallbackStatus` exported for tests.

---

## 5. Env vars to add

```bash
# .env.example
DUITKU_DISB_USER_ID=            # integer merchant id
[email protected]
DUITKU_DISB_SECRET_KEY=         # SHA256 shared secret — rotate via Duitku dashboard
DUITKU_DISB_API_BASE=https://sandbox.duitku.com/webapi/api/disbursement
# switch to https://passport.duitku.com/webapi/api/disbursement in prod
```

`ConfigService` lookups keyed off these names (never `process.env` direct, per port rules).

---

## 6. Schema changes (Prisma) — provider-agnostic refactor

**Design principle:** the schema must be provider-agnostic from the start. Xendit-branded column, table, and enum names become provider-neutral; Duitku slots in additively. The migration is data-preserving (`ALTER TABLE RENAME`), so the existing Xendit flow keeps working bit-for-bit — only identifiers change.

### 6.1 End-state schema

```prisma
// ---- Provider-neutral enum ----
enum ProviderPayoutStatus {   // was: XenditPayoutStatus
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model Merchant {
  id                      String   @id @default(ulid())
  // ...
  payoutChannelCode       String   // was: xenditChannelCode   (canonical, e.g. "BCA", "GOPAY")
  payoutAccountNumber     Bytes    // was: xenditAccountNumber (encrypted bytes, unchanged shape)
  payoutAccountHolderName String   // was: xenditAccountHolderName
  payoutProvider          String   @default("xendit")   // unchanged — "xendit" | "duitku"
  // ...
  payouts ProviderPayout[]   // was: xenditPayouts
}

// ---- Renamed table; provider recorded on the row ----
model ProviderPayout {                   // was: XenditPayout
  id                     String               @id @default(ulid())
  intent                 PaymentIntent        @relation(fields: [intentId], references: [id], onDelete: Restrict)
  intentId               String
  provider               String               // NEW: "xendit" | "duitku" — audit-permanent record
  providerPayoutId       String?              // was: xenditPayoutId    (Xendit disb-id OR Duitku disburseId)
  referenceId            String               // unchanged — == intent.id
  channelCode            String               // unchanged — the canonical code we sent on
  accountNumberEncrypted Bytes                // unchanged
  amount                 Int                  // unchanged (IDR major units)
  currency               String               // unchanged
  status                 ProviderPayoutStatus @default(PENDING)
  providerResponseCode   String?              // NEW: "00" | "TO" | "68" | "-100" | ... for retry/reconcile discipline
  requestedAt            DateTime?            @db.Timestamptz()
  completedAt            DateTime?            @db.Timestamptz()
  webhookReceivedAt      DateTime?            @db.Timestamptz()
  providerResponseBody   Json?                // was: xenditResponseBody
  createdAt              DateTime             @default(now()) @db.Timestamptz()
  updatedAt              DateTime             @updatedAt @db.Timestamptz()

  @@index([intentId])
  @@index([provider, status])   // NEW: ops dashboards + reconcile job scan by (provider, status)
}

// ---- Channel: canonical metadata only; per-provider codes + fees extracted ----
model Channel {
  channelCode   String      @db.Text   // canonical ("BCA", "GOPAY", ...)
  country       String      @db.Char(2)
  label         String
  kind          ChannelKind
  accountFormat String
  priority      Int
  isActive      Boolean     @default(true)
  iconUrl       String?
  // Removed: xenditMinAmountIdr, xenditMaxAmountIdr, xenditFeeIdr
  createdAt     DateTime    @default(now()) @db.Timestamptz()
  updatedAt     DateTime    @updatedAt @db.Timestamptz()

  providerChannels ProviderChannel[]

  @@id([channelCode, country])
  @@index([country, isActive, priority])
}

// ---- NEW: per-provider channel mapping + fee schedule ----
model ProviderChannel {
  id                  String   @id @default(ulid())
  channel             Channel  @relation(fields: [channelCode, country], references: [channelCode, country])
  channelCode         String                           // canonical, e.g. "BCA"
  country             String   @db.Char(2)
  provider            String                           // "xendit" | "duitku"
  providerChannelCode String                           // "BCA" (Xendit) or "014" (Duitku)
  minAmountIdr        Int?
  maxAmountIdr        Int?
  feeIdr              Int
  isActive            Boolean  @default(true)
  createdAt           DateTime @default(now()) @db.Timestamptz()
  updatedAt           DateTime @updatedAt @db.Timestamptz()

  @@unique([channelCode, country, provider])   // one row per (channel, provider)
  @@index([provider, isActive])
}
```

### 6.2 Why each change

| Change | Why |
|---|---|
| `XenditPayout` → `ProviderPayout` | Table name can't lie about its contents — Duitku rows go here too. |
| `xenditPayoutId` → `providerPayoutId` | Same string slot, different provider-side id (`disb-…` vs `disburseId`). |
| `xenditResponseBody` → `providerResponseBody` | Raw response body, provider-agnostic. |
| NEW `provider` column on `ProviderPayout` | Audit-permanent record of which provider handled this disbursement. A merchant may later switch `payoutProvider`; old rows must retain their original attribution without joining through `Merchant`. Filter-at-source for ops dashboards. |
| NEW `providerResponseCode` | Duitku's retry discipline is response-code-driven (`TO`/`68`/`-100` must never be retransmitted). JSON-probing `providerResponseBody->>'responseCode'` works but is fragile across restarts; a dedicated column lets the reconcile job run as an indexed scan. Nullable because Xendit rows don't populate it. |
| NEW `@@index([provider, status])` | The `getStatus`/reconcile job needs to find all non-terminal rows for a given provider cheaply. |
| `Merchant.xenditChannelCode` → `payoutChannelCode` | Stores the **canonical** code (`"BCA"`), not a provider-specific one. Adapters translate via `ProviderChannel`. |
| `Merchant.xenditAccountNumber/HolderName` → `payoutAccountNumber/HolderName` | Data is provider-agnostic; name was a lie. |
| Extract `ProviderChannel` | `Channel` is canonical metadata (label, icon, account format, priority). Provider-specific codes + fees + limits live in `ProviderChannel`. Adding provider #3 means inserting rows, not adding columns. `Channel` stays stable as the merchant-facing catalog. |
| Keep `Merchant.payoutProvider String @default("xendit")` | Already neutral. No rename. |
| Keep `ProviderPayoutStatus` coarse (`PENDING/PROCESSING/COMPLETED/FAILED`) | Maps both providers' terminal states cleanly. Nuances (Duitku `TO` vs `68` vs `-100`) live in `providerResponseCode`. |

### 6.3 Non-breaking migration

The current Xendit flow must keep working identically through and after the rename. Strategy:

1. **Edit `prisma/schema.prisma`** to the §6.1 end-state.
2. **Generate migration SQL skeleton:**
   ```bash
   pnpm prisma migrate dev --create-only --name provider_agnostic_payout
   ```
   Prisma's default diff will be destructive (DROP + CREATE) for renames. Do not apply it as-is.
3. **Hand-edit the generated SQL** to use rename statements:
   ```sql
   -- Enum rename (Postgres supports ALTER TYPE RENAME).
   ALTER TYPE "XenditPayoutStatus" RENAME TO "ProviderPayoutStatus";

   -- Table rename.
   ALTER TABLE "XenditPayout" RENAME TO "ProviderPayout";

   -- Column renames on ProviderPayout.
   ALTER TABLE "ProviderPayout" RENAME COLUMN "xenditPayoutId"     TO "providerPayoutId";
   ALTER TABLE "ProviderPayout" RENAME COLUMN "xenditResponseBody" TO "providerResponseBody";

   -- New columns on ProviderPayout. `provider` backfilled to 'xendit' for existing rows,
   -- then NOT NULL constraint added.
   ALTER TABLE "ProviderPayout" ADD COLUMN "provider"             TEXT;
   UPDATE "ProviderPayout" SET "provider" = 'xendit' WHERE "provider" IS NULL;
   ALTER TABLE "ProviderPayout" ALTER COLUMN "provider" SET NOT NULL;
   ALTER TABLE "ProviderPayout" ADD COLUMN "providerResponseCode" TEXT;
   CREATE INDEX "ProviderPayout_provider_status_idx" ON "ProviderPayout"("provider", "status");

   -- Column renames on Merchant.
   ALTER TABLE "Merchant" RENAME COLUMN "xenditChannelCode"       TO "payoutChannelCode";
   ALTER TABLE "Merchant" RENAME COLUMN "xenditAccountNumber"     TO "payoutAccountNumber";
   ALTER TABLE "Merchant" RENAME COLUMN "xenditAccountHolderName" TO "payoutAccountHolderName";

   -- Create ProviderChannel and backfill Xendit data from Channel before dropping columns.
   CREATE TABLE "ProviderChannel" (
     "id"                  TEXT PRIMARY KEY,
     "channelCode"         TEXT NOT NULL,
     "country"             CHAR(2) NOT NULL,
     "provider"            TEXT NOT NULL,
     "providerChannelCode" TEXT NOT NULL,
     "minAmountIdr"        INT,
     "maxAmountIdr"        INT,
     "feeIdr"              INT NOT NULL,
     "isActive"            BOOLEAN NOT NULL DEFAULT TRUE,
     "createdAt"           TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
     "updatedAt"           TIMESTAMPTZ NOT NULL,
     CONSTRAINT "ProviderChannel_channel_fk"
       FOREIGN KEY ("channelCode", "country")
       REFERENCES "Channel"("channelCode", "country")
   );
   CREATE UNIQUE INDEX "ProviderChannel_channel_provider_unique"
     ON "ProviderChannel"("channelCode", "country", "provider");
   CREATE INDEX "ProviderChannel_provider_isActive_idx"
     ON "ProviderChannel"("provider", "isActive");

   -- Backfill: mirror every existing Channel row as a Xendit ProviderChannel
   -- using the channelCode itself as the xendit providerChannelCode (today they match).
   INSERT INTO "ProviderChannel" (
     "id", "channelCode", "country", "provider", "providerChannelCode",
     "minAmountIdr", "maxAmountIdr", "feeIdr", "isActive", "createdAt", "updatedAt"
   )
   SELECT
     gen_random_uuid()::TEXT,       -- or a ulid() function if installed
     "channelCode",
     "country",
     'xendit',
     "channelCode",                 -- Xendit's code == canonical today
     "xenditMinAmountIdr",
     "xenditMaxAmountIdr",
     "xenditFeeIdr",
     "isActive",
     "createdAt",
     "updatedAt"
   FROM "Channel";

   -- Drop the Xendit-specific Channel columns only AFTER backfill succeeds.
   ALTER TABLE "Channel" DROP COLUMN "xenditMinAmountIdr";
   ALTER TABLE "Channel" DROP COLUMN "xenditMaxAmountIdr";
   ALTER TABLE "Channel" DROP COLUMN "xenditFeeIdr";
   ```
4. **Apply:** `pnpm prisma migrate dev` then `pnpm prisma generate`.
5. **Codemod the call sites** (see §6.4). Every `xendit*` Prisma accessor and type rename is mechanical.
6. **Verify:** unit + e2e green; the existing Xendit happy-path spec must pass unmodified in behaviour (only property names change in assertions).

Run `bash scripts/lint-migrations.sh` after editing the migration SQL — it catches FK-to-hypertable violations (per CLAUDE.md §TimescaleDB rule); `ProviderPayout` is not a hypertable, so we're clear.

### 6.4 Code-level rename scope

Non-generated files that reference the old names (grep for `xenditChannelCode|xenditAccountNumber|xenditAccountHolderName|XenditPayout|xenditPayoutId|xenditResponseBody|XenditPayoutStatus|xenditPayouts|xenditMinAmountIdr|xenditMaxAmountIdr|xenditFeeIdr`):

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

Rename table (one codemod):
- `prisma.xenditPayout.*` → `prisma.providerPayout.*`
- Type imports: `XenditPayout` → `ProviderPayout`, `XenditPayoutStatus` → `ProviderPayoutStatus`.

Rename columns (codemod):
- `.xenditChannelCode` → `.payoutChannelCode`
- `.xenditAccountNumber` → `.payoutAccountNumber`
- `.xenditAccountHolderName` → `.payoutAccountHolderName`
- `.xenditPayoutId` → `.providerPayoutId`
- `.xenditResponseBody` → `.providerResponseBody`
- `.xenditPayouts` → `.payouts` (relation accessor)
- `.xenditMinAmountIdr` → `providerChannel.minAmountIdr` (lookup pattern change — not a rename)
- `.xenditMaxAmountIdr` → `providerChannel.maxAmountIdr`
- `.xenditFeeIdr` → `providerChannel.feeIdr`

DTO/API compatibility: **keep outward JSON field names unchanged** for the first release to avoid breaking mobile/admin clients. Use `@Expose({ name: "xenditChannelCode" })` on the DTO where needed, or introduce the new name as the canonical and add a deprecated alias. Flip the mobile side in a follow-up release.

Wire-format stability in the Xendit adapter (`XenditPayoutProvider.triggerPayout`) does **not** change — it still builds the Xendit request body with `channel_code` from `merchant.payoutChannelCode` (resolved via `ProviderChannel` where `provider = 'xendit'`), and the fact that Xendit's `providerChannelCode` equals the canonical code today means the backfill is a no-op translation. Drop-in.

### 6.5 Functional guarantees after migration

- Existing Xendit rows keep their data (RENAME preserves rows). `provider` = `'xendit'` on every pre-existing `ProviderPayout` row.
- Xendit adapter code path is byte-identical on the wire (same URL, same body, same headers) — only the TS field names it reads change.
- Webhook `POST /webhooks/xendit` unchanged in path, payload shape, and verification.
- Mobile/admin API response shapes preserved via DTO aliases.
- `Channel` catalog endpoints preserved; fees/limits now come from `ProviderChannel` filtered by `Merchant.payoutProvider`.

---

## 7. Testing plan

1. **Unit — signature vectors:** parity tests for all five SHA256 formulas against known-good inputs from Duitku's PHP SDK (github.com/duitkupg/duitku-php). Lock the byte-for-byte concatenation order.
2. **Unit — adapter happy path:** mock `httpFetch` returning a `responseCode: "00"` transfer response; assert `TPayoutReceipt` shape matches Xendit's (same keys, same `status: "COMPLETED"`).
3. **Unit — name mismatch:** mock Inquiry returning a different `accountName` than `merchant.xenditAccountHolderName`; assert we abort before calling Transfer and throw `PayoutProviderError({ kind: "client_error" })`.
4. **Unit — response-code retry filter:** mock `responseCode: "68"`; assert the adapter returns a `PENDING` receipt and does NOT retransmit.
5. **Unit — `getStatus` reconcile:** mock `inquirystatus` returning `"00"`; assert mapping to `"COMPLETED"`.
6. **Unit — secret redaction:** capture logger output on a failing call; assert the secret key and raw account number never appear.
7. **Integration — sandbox end-to-end:** using the public sandbox creds in §2.9, run one happy path + one `TO` path + one `68` path against `sandbox.duitku.com`. Gate behind `RUN_DUITKU_SANDBOX_E2E=1` (skipped in CI).
8. **Module wiring:** load `PayoutModule`, set a test merchant's `payoutProvider` to `"duitku"`, and assert `PayoutService.trigger(intentId)` routes to the Duitku adapter (not Xendit). This catches `resolveProvider` regressions.
9. **Migration data-preservation:** seed a snapshot DB with a handful of `XenditPayout` + `Channel` rows, run the rename migration, assert row counts and every non-renamed field value unchanged, and every pre-existing `ProviderPayout` row has `provider = 'xendit'`. Assert `ProviderChannel` has one `xendit` row per old `Channel`. Gated behind `RUN_MIGRATION_SNAPSHOT=1` so CI doesn't need a scratch DB.
10. **Xendit behaviour parity:** re-run the existing `xendit-payout.provider.spec.ts` suite after the rename — every assertion passes with only property-name updates, proving wire-format is unchanged.

---

## 8. Open questions / future work

1. **Provider selection policy.** Today `merchant.payoutProvider` is per-merchant and set at merchant-creation time. Do we want per-intent override (e.g. fail-over to Duitku when Xendit is degraded)? If yes, add a nullable `payoutProviderOverride` on `PaymentIntent` and teach `resolveProvider` to prefer it. Out of scope for v1.
2. **DTO field rename deprecation window.** v1 ships with backward-compatible `@Expose` aliases so mobile/admin keep reading `xenditChannelCode` etc. in responses. Schedule a follow-up release to flip mobile to the new names and drop the aliases.
3. **Duitku SNAP API.** Duitku also offers a BI-SNAP-compliant disbursement product at a separate base URL. Worth evaluating if BI enforces SNAP for UMKM flows in 2026; not needed for our current launch.
4. **IP allow-listing.** Both egress (our server → Duitku) and ingress (Duitku callback → us) need Duitku support to whitelist our IPs. This is a pre-prod ops task, not a code task.
5. **Account-number encryption.** The `security_review_needed.md` item still applies — the `account-number-crypto.ts` helper is a base64 stopgap. Duitku integration does not change this, but do not ship to production until real envelope crypto lands.
6. **H2H / Cash-Out extension.** Out of scope for v1; §2.8 documents the callback verifier we'd need when we add them.

---

## 9. Payment-gateway (inbound) notes — for later

If we later accept payments via Duitku (not just disburse), the shape is different enough to warrant a separate provider module:

- **Base URL same host, different path:** `/api/merchant/v2/inquiry` (create transaction, JSON) and `/api/merchant/transactionStatus` (check, **form-urlencoded**).
- **Signature is MD5 (not SHA256):** `md5(merchantCode + merchantOrderId + paymentAmount + apiKey)` for createInvoice, `md5(merchantCode + amount + merchantOrderId + apiKey)` for callback verification.
- **Callback replies with plain text `"SUCCESS"`** (not JSON).
- **Credentials are separate** (`merchantCode` + `apiKey` pair, distinct from disbursement `userId`/`email`/`secretKey`).
- **getPaymentMethod uses SHA256**, not MD5.

Treat it as a parallel adapter family (`DuitkuPaymentGatewayProvider`) when the time comes. Do not try to share a client with the disbursement adapter — the auth, content-types, and response-contract shapes are unrelated enough that the abstraction would leak.

---

## References

- Duitku Disbursement API (EN): https://docs.duitku.com/disbursement/en/
- Duitku Disbursement Feature Overview: https://docs.duitku.com/en/disbursement-feature/overview/
- Duitku Payment Gateway Overview: https://docs.duitku.com/payment-gateway/overview/
- Duitku PHP SDK (canonical signature reference): https://github.com/duitkupg/duitku-php
- Local spec the port descends from: `umkm-usdc-payout-spec.md §6.4, §6.6` (not in repo; referenced by port header)
- Port definition: `src/payout/payout-provider.port.ts`
- Existing adapter: `src/payout/providers/xendit-payout.provider.ts`
- Current webhook handler: `src/payout/webhook.controller.ts`
