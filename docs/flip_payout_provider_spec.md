# Flip Business Payout Provider — Engineering Spec

**Author:** Engineering  
**Date:** 2026-04-26  
**Status:** Draft  
**Scope:** Add Flip Business as a third payout provider (`"flip"`) in `src/payout/`, slotting into the existing `IPayoutProviderAdapter` space-docking port alongside Xendit and Duitku.

---

## 1. Motivation

Flip Business (https://flip.id) is a licensed Indonesian money-transfer aggregator with competitive disbursement fees and broad bank + e-wallet coverage. Adding Flip gives merchants a third payout rail choice, improving redundancy (failover when one provider is degraded) and potentially lower per-transaction costs for high-volume UMKM merchants.

---

## 2. Flip Business Disbursement API — Summary

Source: https://docs.flip.id/docs/money-transfer/integration

### 2.1 Credentials

- **Secret Key** — issued from the Flip for Business dashboard. Used as the HTTP Basic Auth username with an empty password.
- **Validation Token** — static token configured in the dashboard, sent by Flip in webhook callbacks for verification.
- No IP allowlisting required (unlike Duitku).

### 2.2 Base URLs

| Environment | Base URL |
|---|---|
| **Sandbox** | `https://bigflip.id/big_sandbox_api/v2` |
| **Production** | `https://bigflip.id/api/v2` |

V3 endpoints exist but disbursement works on v2 which is sufficient for our needs.

### 2.3 Authentication

HTTP Basic Auth. The secret key is the username; password is empty. The `Authorization` header value is `Basic base64("SECRET_KEY:")` (note the trailing colon before encoding).

Required headers on every request:
```
Authorization: Basic <base64(FLIP_SECRET_KEY:)>
Content-Type: application/x-www-form-urlencoded
Accept: application/json
```

**Important:** Flip requires `application/x-www-form-urlencoded` request bodies, NOT JSON. This is a significant difference from both Xendit (JSON) and Duitku (JSON).

### 2.4 Endpoints We Need

| Purpose | Method | Path | Maps to |
|---|---|---|---|
| Create Disbursement | POST | `/disbursement` | `triggerPayout()` |
| Get Disbursement by ID | GET | `/disbursement/{id}` | `getStatus()` |
| Get Disbursement by Idempotency Key | GET | `/disbursement?idempotency_key={key}` | reconcile fallback |
| Bank Account Inquiry | POST | `/disbursement/bank-account-inquiry` | optional pre-check |
| Get Balance | GET | `/general/balance` | ops helper (like Duitku `checkBalance`) |
| Get Banks | GET | `/general/banks` | seed helper for `ProviderChannel` |
| Check Maintenance | GET | `/general/maintenance` | circuit-breaker input |

### 2.5 Create Disbursement — Request/Response

**Request** (form-urlencoded body):

| Parameter | Type | Required | Notes |
|---|---|---|---|
| `account_number` | string | Yes | Recipient bank account / e-wallet number |
| `bank_code` | string | Yes | Flip bank code (e.g. `bca`, `bni`, `mandiri`, `gopay`, `ovo`) |
| `amount` | integer | Yes | Amount in IDR (> 0) |
| `remark` | string | No | Transfer note, **max 18 characters** |
| `recipient_city` | integer | No | City code from Flip's city-list |
| `beneficiary_email` | string | No | Recipient email notification |

**Idempotency:** The `idempotency-key` HTTP header is **required**. We set it to `intent.id` (same pattern as Xendit's `Idempotency-key` and Duitku's `custRefNumber`). Flip returns the original transaction on duplicate keys.

**Response (200 OK):**
```json
{
  "id": 123,
  "user_id": 456,
  "amount": 100000,
  "status": "PENDING",
  "timestamp": "2026-04-26 10:00:00",
  "bank_code": "bca",
  "account_number": "0012345678",
  "recipient_name": "John Doe",
  "sender_bank": "bsm",
  "remark": "TakumiPay abc123",
  "receipt": "",
  "time_served": "0000-00-00 00:00:00",
  "bundle_id": 0,
  "company_id": 789,
  "recipient_city": 0,
  "created_from": "API",
  "direction": "DOMESTIC_TRANSFER",
  "sender": null,
  "fee": 4000
}
```

### 2.6 Transaction Status Values

| Flip Status | Our `TProviderStatus` | Terminal? |
|---|---|---|
| `PENDING` | `PENDING` | No |
| `DONE` | `COMPLETED` | Yes |
| `CANCELLED` | `FAILED` | Yes |

Simpler than both Xendit (6 statuses) and Duitku (10+ response codes). Only three states.

### 2.7 Callback / Webhook

Flip sends a POST callback when a disbursement reaches `DONE` or `CANCELLED`.

**Content-Type:** `application/x-www-form-urlencoded`

**Body fields:**

| Field | Description |
|---|---|
| `data` | JSON-encoded string with the full disbursement object |
| `token` | Validation token (static shared secret, configured in Flip dashboard) |

**Verification:** Compare `token` against our stored `FLIP_VALIDATION_TOKEN` using constant-time comparison (same pattern as Xendit's `x-callback-token`).

**Additional security headers (newer Flip implementation):**
- `Webhook-Id` — for idempotent callback handling
- `Webhook-Signature` — body signature verification
- `Webhook-Timestamp` — UNIX timestamp for replay protection

**Retry policy:** Flip retries **5 times** at **2-minute intervals** if our endpoint returns non-200 or times out (30s).

### 2.8 Supported Destinations — Complete Bank & E-Wallet Code Reference

Source: Flip Money Transfer docs — Destination Bank Code page. Also available via `GET /general/banks`.

Flip supports VA disbursement for BNI, BRI, CIMB, Mandiri, Danamon, Muamalat, and Permata.

#### Banks

| Flip Code | Bank Name |
|---|---|
| `harda` | Allo Bank / Bank Harda Internasional |
| `anz` | ANZ Indonesia |
| `aceh` | Bank Aceh Syariah |
| `aladin` | Bank Aladin Syariah / Bank Maybank Syariah |
| `amar` | Bank Amar Indonesia |
| `antardaerah` | Bank Antardaerah |
| `artha` | Bank Artha Graha Internasional |
| `bengkulu` | Bank Bengkulu |
| `daerah_istimewa` | Bank BPD DIY |
| `daerah_istimewa_syr` | Bank BPD DIY Syariah |
| `btpn_syr` | Bank BTPN Syariah |
| `bukopin_syr` | Bank Bukopin Syariah |
| `bumi_arta` | Bank Bumi Arta |
| `capital` | Bank Capital Indonesia |
| `bca` | Bank Central Asia |
| `ccb` | Bank China Construction Bank Indonesia |
| `cnb` | Bank CNB (Centratama Nasional Bank) |
| `danamon` | Bank Danamon & Danamon Syariah |
| `dinar` | Bank Dinar Indonesia / Bank Oke Indonesia |
| `dki` | Bank DKI |
| `dki_syr` | Bank DKI Syariah |
| `ganesha` | Bank Ganesha |
| `agris` | Bank IBK Indonesia |
| `ina_perdana` | Bank Ina Perdana |
| `index_selindo` | Bank Index Selindo |
| `artos_syr` | Bank Jago Syariah |
| `jambi` | Bank Jambi |
| `jambi_syr` | Bank Jambi Syariah |
| `jasa_jakarta` | Bank Jasa Jakarta |
| `jawa_tengah` | Bank Jateng |
| `jawa_tengah_syr` | Bank Jateng Syariah |
| `jawa_timur` | Bank Jatim |
| `jawa_timur_syr` | Bank Jatim Syariah |
| `kalimantan_barat` | Bank Kalbar |
| `kalimantan_barat_syr` | Bank Kalbar Syariah |
| `kalimantan_selatan` | Bank Kalsel |
| `kalimantan_selatan_syr` | Bank Kalsel Syariah |
| `kalimantan_tengah` | Bank Kalteng |
| `kalimantan_timur_syr` | Bank Kaltim Syariah |
| `kalimantan_timur` | Bank Kaltimtara |
| `lampung` | Bank Lampung |
| `maluku` | Bank Maluku |
| `mandiri` | Bank Mandiri |
| `mantap` | Bank MANTAP (Mandiri Taspen) |
| `maspion` | Bank Maspion Indonesia |
| `mayapada` | Bank Mayapada |
| `mayora` | Bank Mayora Indonesia |
| `mega` | Bank Mega |
| `mega_syr` | Bank Mega Syariah |
| `mestika_dharma` | Bank Mestika Dharma |
| `mizuho` | Bank Mizuho Indonesia |
| `mas` | Bank Multi Arta Sentosa (Bank MAS) |
| `mutiara` | Bank Mutiara / Bank JTrust Indonesia |
| `sumatera_barat` | Bank Nagari |
| `sumatera_barat_syr` | Bank Nagari Syariah |
| `nusa_tenggara_barat` | Bank NTB Syariah |
| `nusa_tenggara_timur` | Bank NTT |
| `nusantara_parahyangan` | Bank Nusantara Parahyangan |
| `ocbc` | Bank OCBC NISP |
| `ocbc_syr` | Bank OCBC NISP Syariah |
| `america_na` | Bank of America NA |
| `boc` | Bank of China (Hong Kong) Limited |
| `india` | Bank of India Indonesia |
| `tokyo` | Bank of Tokyo Mitsubishi UFJ |
| `papua` | Bank Papua |
| `prima` | Bank Prima Master |
| `bri` | Bank Rakyat Indonesia |
| `riau_dan_kepri` | Bank Riau Kepri |
| `sahabat_sampoerna` | Bank Sahabat Sampoerna |
| `shinhan` | Bank Shinhan Indonesia |
| `sinarmas` | Bank Sinarmas |
| `sinarmas_syr` | Bank Sinarmas Syariah |
| `sulselbar` | Bank Sulselbar |
| `sulselbar_syr` | Bank Sulselbar Syariah |
| `sulawesi` | Bank Sulteng |
| `sulawesi_tenggara` | Bank Sultra |
| `sulut` | Bank SulutGo |
| `sumsel_dan_babel` | Bank Sumsel Babel |
| `sumsel_dan_babel_syr` | Bank Sumsel Babel Syariah |
| `sumut` | Bank Sumut |
| `sumut_syr` | Bank Sumut Syariah |
| `resona_perdania` | Bank Resona Perdania |
| `victoria_internasional` | Bank Victoria International |
| `victoria_syr` | Bank Victoria Syariah |
| `woori` | Bank Woori Saudara |
| `bca_syr` | BCA Syariah |
| `bjb` | BJB |
| `bjb_syr` | BJB Syariah |
| `royal` | Blu / BCA Digital |
| `bni` | BNI (Bank Negara Indonesia) |
| `bnp_paribas` | BNP Paribas Indonesia |
| `bali` | BPD Bali |
| `banten` | BPD Banten |
| `eka` | BPR EKA (Bank Eka) |
| `agroniaga` | BRI Agroniaga / Bank Raya Indonesia |
| `bsm` | BSI (Bank Syariah Indonesia) |
| `btn` | BTN |
| `btn_syr` | BTN Syariah |
| `tabungan_pensiunan_nasional` | BTPN |
| `cimb` | CIMB Niaga & CIMB Niaga Syariah |
| `citibank` | Citibank |
| `commonwealth` | Commonwealth Bank |
| `chinatrust` | CTBC (Chinatrust) Indonesia |
| `dbs` | DBS Indonesia |
| `hsbc` | HSBC Indonesia |
| `icbc` | ICBC Indonesia |
| `artos` | Jago / Artos |
| `hana` | LINE Bank / KEB Hana |
| `bii` | Maybank Indonesia |
| `mnc_internasional` | Motion / MNC Bank |
| `muamalat` | Muamalat |
| `yudha_bakti` | Neo Commerce / Yudha Bhakti |
| `nationalnobu` | Nobu (Nationalnobu) Bank |
| `panin` | Panin Bank |
| `panin_syr` | Panin Dubai Syariah |
| `permata` | Permata |
| `permata_syr` | Permata Syariah |
| `qnb_kesawan` | QNB Indonesia |
| `rabobank` | Rabobank International Indonesia |
| `sbi_indonesia` | SBI Indonesia |
| `kesejahteraan_ekonomi` | Seabank / Bank BKE |
| `standard_chartered` | Standard Chartered Bank |
| `super_bank` | Superbank |
| `uob` | TMRW / UOB |
| `bukopin` | Wokee / Bukopin |
| `krom` | Krom Bank Indonesia |
| `deutsche` | Deutsche Bank AG |
| `saqu` | Bank Saqu |

#### E-Wallets

| Flip Code | E-Wallet Name |
|---|---|
| `dana` | DANA |
| `gopay` | GoPay |
| `linkaja` | LinkAja |
| `ovo` | OVO |
| `shopeepay` | ShopeePay |

### 2.9 Error Handling

**General error (401, 404, 503):**
```json
{
  "status": 401,
  "name": "Unauthorized",
  "message": "Unauthorized access"
}
```

**Validation error (422):**
```json
{
  "code": "VALIDATION_ERROR",
  "errors": [
    {
      "attribute": "amount",
      "code": 1050,
      "message": "Amount must be greater than 0"
    }
  ]
}
```

### 2.10 Sandbox Behavior

- Disbursements always return `PENDING` status.
- Use the Flip sandbox dashboard to simulate `DONE` or `CANCELLED` via "Force Success" / "Force Failed" buttons.
- Callbacks fire after manual simulation.
- Sandbox provides simulated balance.

---

## 3. Delta vs Existing Providers

| Dimension | Xendit | Duitku | Flip |
|---|---|---|---|
| **Auth** | HTTP Basic (secret as username) | Body-embedded userId + email + SHA256 signature | HTTP Basic (secret as username) |
| **Request format** | JSON | JSON | **form-urlencoded** |
| **Idempotency** | `Idempotency-key` header | `custRefNumber` in body | `idempotency-key` header |
| **Flow** | Single POST → callback | Inquiry → Transfer (two-step) | **Single POST → callback** |
| **Status model** | 6 statuses (PENDING, PROCESSING, COMPLETED, FAILED, EXPIRED, CANCELLED) | Response codes (00, TO, 68, -100, etc.) | **3 statuses (PENDING, DONE, CANCELLED)** |
| **Callback format** | JSON body + `x-callback-token` header | No callback (RTOL) | **form-urlencoded body with JSON `data` field + `token` field** |
| **Callback verification** | Static shared secret in header | N/A (v1) | Static shared secret in body (`token` field) |
| **Reconcile** | Stub (webhook is SoT) | Required (`inquirystatus` for ambiguous codes) | `GET /disbursement/{id}` (optional, webhook is SoT) |
| **Remark limit** | ~255 chars | N/A | **18 characters** |
| **Bank codes** | Xendit codes (e.g. `ID_BCA`) | Duitku numeric codes (e.g. `014`) | Flip lowercase codes (e.g. `bca`) |

**Key takeaways for implementation:**
1. Flip is architecturally closer to Xendit than Duitku — single-step disbursement + webhook-driven status.
2. The form-urlencoded body format is unique and requires a dedicated serializer (cannot reuse JSON body logic).
3. Webhook parsing differs: Flip sends `data` as a JSON string inside a form-urlencoded body, requiring two-stage parsing.
4. The 18-char remark limit means our standard `"TakumiPay payout {intent.id}"` won't fit. Truncate to last 18 chars of intent ID.

---

## 4. Implementation Plan

### 4.1 New Files

| File | Purpose |
|---|---|
| `src/payout/providers/flip-payout.provider.ts` | `FlipPayoutProvider implements IPayoutProviderAdapter` |
| `src/payout/providers/flip-payout.provider.spec.ts` | Unit tests |
| `src/payout/flip-channels.ts` | Canonical channel → Flip bank code mapping (mirrors `duitku-channels.ts`) |

### 4.2 Modified Files

| File | Change |
|---|---|
| `src/payout/payout-provider.port.ts` | Add `PAYOUT_PROVIDER_FLIP` symbol token |
| `src/payout/payout.module.ts` | Register `FlipPayoutProvider`, bind to token, add to providers array |
| `src/payout/payout.service.ts` | Inject `PAYOUT_PROVIDER_FLIP`, add `case "flip"` to `resolveProvider()` |
| `src/payout/webhook.controller.ts` | Add `POST /webhooks/flip` endpoint |
| `.env.example` | Add `FLIP_SECRET_KEY`, `FLIP_VALIDATION_TOKEN`, `FLIP_API_BASE` |
| Seed script | Add `ProviderChannel` rows for `provider = "flip"` |

### 4.3 `FlipPayoutProvider` — Adapter Contract

```typescript
@Injectable()
export class FlipPayoutProvider implements IPayoutProviderAdapter {

  async triggerPayout(intent: PaymentIntent, merchant: Merchant): Promise<TPayoutReceipt> {
    // 1. Resolve Flip bank code from ProviderChannel table
    // 2. Decrypt merchant account number
    // 3. Build form-urlencoded body
    // 4. POST to /disbursement with idempotency-key = intent.id
    // 5. Map response to TPayoutReceipt
  }

  async getStatus(providerReferenceId: string): Promise<TProviderStatusResult> {
    // GET /disbursement/{id}
    // Map PENDING/DONE/CANCELLED to TProviderStatus
  }

  verifyWebhookSignature(headers, body): boolean {
    // Parse form-urlencoded body, extract `token` field
    // Constant-time compare against FLIP_VALIDATION_TOKEN
    // Optionally verify Webhook-Signature header for additional security
  }
}
```

### 4.4 Retry Discipline

Match the existing pattern (Xendit/Duitku):
- 60s per-request timeout via `AbortController`
- 5xx / network errors / timeouts → exponential backoff, 3 attempts max (100ms, 400ms, 1600ms)
- 4xx → terminal, no retry
- 2xx → return receipt

Flip's disbursement is idempotent (via `idempotency-key` header), so retries on transport failures are safe — Flip returns the original transaction on duplicate keys.

### 4.5 Form-Urlencoded Serialization

Flip requires `application/x-www-form-urlencoded`, not JSON. Use Node's built-in `URLSearchParams`:

```typescript
private buildFormBody(params: Record<string, string | number>): string {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    form.append(key, String(value));
  }
  return form.toString();
}
```

Headers for disbursement requests:
```typescript
{
  Authorization: `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`,
  "Content-Type": "application/x-www-form-urlencoded",
  Accept: "application/json",
  "idempotency-key": intent.id,
}
```

### 4.6 Webhook Controller — `POST /webhooks/flip`

```
POST /webhooks/flip
Content-Type: application/x-www-form-urlencoded

data={"id":123,"status":"DONE","bank_code":"bca",...}&token=VALIDATION_TOKEN
```

Parsing steps:
1. NestJS receives the form body. Extract `data` (string) and `token` (string).
2. Verify `token` against `FLIP_VALIDATION_TOKEN` using `timingSafeEqual`.
3. Parse `data` as JSON to get the disbursement object.
4. Extract `id` (Flip's disbursement ID) and `status` from the parsed data.
5. Look up `ProviderPayout` row by `providerPayoutId = String(id)`.
6. Map status and persist (same logic as Xendit webhook — DONE→COMPLETED+PAID_OUT, CANCELLED→FAILED).

**NestJS body parsing note:** The webhook endpoint needs raw form-urlencoded parsing. Use `@Body()` with NestJS's built-in urlencoded parser, or use a raw body decorator if the default JSON parser interferes. Configure the route to accept `application/x-www-form-urlencoded`.

### 4.7 Flip Channel Code Mapping & Seed Script

Create `src/payout/flip-channels.ts` with the complete mapping from our canonical channel codes to Flip's `bank_code` values. The full Flip code reference is in §2.8.

The seed script must insert `ProviderChannel` rows for every channel we support with Flip. Pattern follows the existing Duitku seed (see `duitku-channels.ts` → seed script).

**Seed requirements:**
- One `ProviderChannel` row per `(channelCode, country, provider="flip")` tuple.
- `providerChannelCode` = Flip's bank code from §2.8 (e.g. `"bca"`, `"gopay"`).
- `feeIdr` = Flip's per-bank fee (available via `GET /general/banks` — the `fee` field). Seed with current known fees; reconcile periodically.
- `isActive = true` for channels we want to enable on day one.
- Use `upsert` so re-running seed is idempotent (same as Duitku).

**Phase 1 channels** (match existing Xendit/Duitku coverage):

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

Additional banks from §2.8 (100+ total) can be seeded in follow-up phases as merchant demand requires. The `flip-channels.ts` file should contain the Phase 1 mapping; the full §2.8 list serves as the reference for future expansion.

### 4.8 Environment Variables

```env
# Flip Business — Disbursement
FLIP_SECRET_KEY=           # Secret key from Flip dashboard (HTTP Basic Auth username)
FLIP_VALIDATION_TOKEN=     # Webhook validation token from Flip dashboard
FLIP_API_BASE=https://bigflip.id/big_sandbox_api/v2   # Sandbox default; prod = https://bigflip.id/api/v2
```

### 4.9 DI Wiring

In `payout-provider.port.ts`:
```typescript
export const PAYOUT_PROVIDER_FLIP = Symbol("PAYOUT_PROVIDER_FLIP");
```

In `payout.module.ts`:
```typescript
providers: [
  // ... existing
  FlipPayoutProvider,
  { provide: PAYOUT_PROVIDER_FLIP, useExisting: FlipPayoutProvider },
]
```

In `payout.service.ts`:
```typescript
constructor(
  // ... existing
  @Inject(PAYOUT_PROVIDER_FLIP)
  private readonly flipProvider: IPayoutProviderAdapter,
) {}

private resolveProvider(key: string): IPayoutProviderAdapter | null {
  switch (key) {
    case "xendit": return this.xenditProvider;
    case "duitku": return this.duitkuProvider;
    case "flip":   return this.flipProvider;
    default:       return null;
  }
}
```

---

## 5. Status Mapping

### 5.1 Disbursement Response → `TProviderStatus`

```typescript
private mapFlipStatus(raw: string | undefined): TProviderStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "DONE":      return "COMPLETED";
    case "CANCELLED": return "FAILED";
    case "PENDING":
    default:          return "PENDING";
  }
}
```

### 5.2 Webhook Callback → `ProviderPayoutStatus`

```typescript
function mapFlipCallbackStatus(raw: string | undefined): ProviderPayoutStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "DONE":      return ProviderPayoutStatus.COMPLETED;
    case "CANCELLED": return ProviderPayoutStatus.FAILED;
    case "PENDING":
    default:          return ProviderPayoutStatus.PENDING;
  }
}
```

---

## 6. Remark Truncation

Flip's `remark` field has an 18-character limit. Our standard format `"TakumiPay payout {intent.id}"` exceeds this. Strategy:

```typescript
// Use last 18 chars of the ULID intent ID as the remark.
// ULIDs are 26 chars — the trailing 18 chars are the random component,
// which is unique enough for support-case triangulation.
const remark = intent.id.slice(-18);
```

This is only a display remark on the recipient's bank statement — the `idempotency-key` header carries the full `intent.id` for correlation.

---

## 7. Bank Account Inquiry (Optional Pre-check)

Flip provides `POST /disbursement/bank-account-inquiry` which validates account numbers before disbursement. Unlike Duitku's mandatory inquiry step, this is optional — Flip handles validation internally during disbursement.

**Recommendation:** Skip the inquiry step for v1. Flip's disbursement endpoint handles invalid accounts by returning `CANCELLED` status. If ops wants pre-validation (e.g., for merchant onboarding), add it as a separate utility method on `FlipPayoutProvider` (like Duitku's `checkBalance`) — not on the `IPayoutProviderAdapter` interface.

---

## 8. Reconcile / Polling

Flip's webhook is the source of truth (same as Xendit). The `getStatus()` implementation calls `GET /disbursement/{id}` as a fallback for cases where the webhook didn't arrive.

Unlike Duitku, there are no ambiguous response codes — Flip's create-disbursement always returns `PENDING`, and the webhook delivers the terminal state. No reconcile-hint plumbing needed.

`getStatus()` is a real implementation (unlike Xendit's stub), useful for:
- Manual ops reconciliation
- Webhook-missed edge cases
- Dashboard status checks

---

## 9. Fees

Flip charges per-disbursement fees that vary by destination bank. The `GET /general/banks` endpoint returns the current fee per bank:

```json
{
  "bank_code": "bca",
  "name": "Bank Central Asia",
  "fee": 4000,
  "queue": 2,
  "status": "OPERATIONAL"
}
```

Seed the `ProviderChannel.feeIdr` column from this data. Consider a periodic reconciliation job to detect fee changes (follow-up, not v1).

---

## 10. Maintenance / Circuit Breaker

Flip provides `GET /general/maintenance` which returns `{ "maintenance": true/false }`. This can feed into a circuit-breaker that short-circuits `triggerPayout()` with a clear error when Flip is down, avoiding wasted timeout cycles.

**v1:** Log a warning if `GET /general/banks?code={code}` returns `status: "HEAVILY_DISTURBED"` for the target bank. Circuit-breaker implementation is a follow-up.

---

## 11. Security Considerations

1. **Secret key never logged.** `buildAuthHeader()` constructs the Basic auth value; never stringified in logs.
2. **Account number never logged.** Only `redactAccountNumber()` output appears in logs — same as Xendit/Duitku adapters.
3. **Webhook token verification** uses `timingSafeEqual` — same pattern as Xendit's `x-callback-token`.
4. **Webhook-Signature header** (Flip's newer HMAC scheme) should be verified when present, as defense-in-depth on top of the `token` field.
5. **Replay protection:** Check `Webhook-Timestamp` header against current time (reject if > 5 min old). Check `Webhook-Id` for idempotent processing.

---

## 12. Testing Strategy

### 12.1 Unit Tests (`flip-payout.provider.spec.ts`)

- Mock `fetch` via constructor injection (same as Xendit/Duitku).
- Test cases:
  - Happy path: 200 → `PENDING` receipt with correct fields
  - Idempotent retry: same `idempotency-key` returns original transaction
  - 401 → `PayoutProviderError` kind `client_error`
  - 422 validation error → `PayoutProviderError` kind `client_error`
  - 503 maintenance → retry then `PayoutProviderError` kind `server_error`
  - Timeout → `PayoutProviderError` kind `timeout`
  - Form-urlencoded body serialization correctness
  - Remark truncation to 18 chars
  - Status mapping (PENDING, DONE, CANCELLED)

### 12.2 Webhook Controller Tests

- Valid token + DONE → ProviderPayout COMPLETED + PaymentIntent PAID_OUT
- Valid token + CANCELLED → ProviderPayout FAILED, intent stays SETTLED
- Missing token → 401
- Invalid token → 403
- Unknown disbursement ID → 404
- Idempotent re-delivery → 200 no-op
- Form-urlencoded body parsing (data field as JSON string)

### 12.3 Integration Testing (Sandbox)

- Create disbursement in Flip sandbox
- Verify callback receipt after "Force Success" / "Force Failed" in dashboard
- Verify `GET /disbursement/{id}` returns correct status
- Verify balance check `GET /general/balance`

---

## 13. Migration / Rollout

1. **Database:** No schema migration needed. `ProviderPayout.provider` is a freeform string — `"flip"` rows work immediately. `ProviderChannel` rows need seeding.
2. **Merchant config:** Set `merchant.payoutProvider = "flip"` for merchants opting in. Default remains `"xendit"`.
3. **Feature flag:** Not needed — the provider is selected per-merchant via the `payoutProvider` column. Rollout is merchant-by-merchant.
4. **Rollback:** Switch `merchant.payoutProvider` back to `"xendit"` or `"duitku"`. In-flight Flip payouts continue to receive webhooks and reconcile normally.

---

## 14. Open Questions

1. **Flip fee structure for e-wallets** — confirm whether e-wallet disbursements (GoPay, OVO, etc.) have different fees than bank transfers.
2. **Flip rate limits** — not publicly documented. Contact `b2b-api-integration@flip.id` for production limits before go-live.
3. **Webhook-Signature verification** — confirm the HMAC scheme (algorithm, signing key, body format) from Flip's updated webhook security docs.
4. **Special disbursement (PJP)** — Flip has a separate `/special-disbursement` endpoint for KYC-required transfers. Determine if any UMKM merchants require this flow.
5. **Timestamps are GMT+7** — Flip returns timestamps in `yyyy-mm-dd hh:mm:ss` GMT+7. Confirm whether to store as-is or convert to UTC in `ProviderPayout.providerResponseBody`.

---

## 15. Task Breakdown

| # | Task | Deps | Estimate |
|---|---|---|---|
| 1 | Create `flip-channels.ts` channel mapping | — | 0.5h |
| 2 | Create `FlipPayoutProvider` adapter (triggerPayout + getStatus) | 1 | 3h |
| 3 | Add `PAYOUT_PROVIDER_FLIP` token + DI wiring in module + service | 2 | 0.5h |
| 4 | Add `POST /webhooks/flip` endpoint in webhook controller | 2 | 2h |
| 5 | Add `verifyWebhookSignature` to adapter | — | 1h |
| 6 | Unit tests for adapter | 2 | 2h |
| 7 | Unit tests for webhook endpoint | 4 | 1.5h |
| 8 | Seed `ProviderChannel` rows for Flip | 1 | 1h |
| 9 | Update `.env.example` + docs | — | 0.5h |
| 10 | Sandbox integration test | 2, 4 | 2h |
| | **Total** | | **~14h** |
