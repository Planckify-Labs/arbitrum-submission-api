# Task 16 — Duitku sandbox e2e (gated `RUN_DUITKU_SANDBOX_E2E=1`)

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.9 (sandbox creds), §7 bullet 7

## Why this matters

Signature fixtures (task 12) prove our bytes match the PHP SDK's
bytes. Unit tests (task 13) prove the adapter handles mocked
responses correctly. Neither proves Duitku's live sandbox actually
accepts our requests. A handful of real calls against
`sandbox.duitku.com` close the loop — signature is accepted, IP
allow-list is right (for the sandbox), response-code flow matches
the adapter's interpretation. It's slow and flaky-by-network-nature,
so it is **opt-in** via env flag.

**Depends on:** all prior tasks (this is the end-to-end smoke).

## Scope

Create `test/e2e/duitku-sandbox.e2e.spec.ts`:

- Gate with `RUN_DUITKU_SANDBOX_E2E=1`. If unset, the whole file is
  skipped.
- Read sandbox creds from research §2.9 (public in Duitku docs,
  safe to hardcode in the test file):
  - `userId = 3551`
  - `email = "pg@merchantpgtest.com"`
  - `secretKey = "de56f832487bc1ce1de5ff2cfacf8d9486c61da69df6fd61d5537b6b7d6d354d"`
  - `apiBase = "https://sandbox.duitku.com/webapi/api/disbursement"`
- Build a `DuitkuPayoutProvider` instance with these creds (bypass
  `ConfigService` — use a direct constructor injection in the test
  so the app env is untouched).
- Test cases, each a real HTTP round-trip:
  1. **Happy path:** bankAccount suffix `…66` → expect
     `responseCode: "00"` on transfer. Adapter maps to `COMPLETED`.
  2. **Timeout path:** suffix `…11` → expect `responseCode: "TO"`.
     Adapter returns `PENDING` + reconcile hint.
  3. **Pending path:** suffix `…64` → expect `responseCode: "68"`.
     Adapter returns `PENDING` + reconcile hint.
  4. **Insufficient funds:** suffix `…62` → expect
     `responseCode: "-510"`. Adapter maps to `FAILED`.
  5. **inquiryStatus reconcile:** after the `…11` transfer, call
     `getStatus(disburseId)` and assert it returns a structured
     response (exact status may vary — sandbox behavior is advisory).

## Rules (non-negotiable)

- **Skipped by default.** `RUN_DUITKU_SANDBOX_E2E=1` is the only way
  to run this file. CI's default lane does not set the flag.
- **Use the published sandbox creds only.** Do not commit prod
  creds, ever. Do not read prod `.env`.
- **Do not allocate real intent IDs.** Generate per-test `custRefNumber`
  values (UUID-based) so re-runs don't hit `-142 Transaction Already
  Finished`.
- **Tolerant assertions where sandbox is non-deterministic.** For
  reconcile-path results, assert "status in { `PENDING`, `FAILED`,
  `COMPLETED` }" not a specific terminal state — sandbox can settle
  asynchronously.
- **Log response bodies at DEBUG** for diagnosing sandbox drift, but
  still redact `secretKey` (test runs on dev machines; discipline
  matters).

## Acceptance

- [ ] File exists at `test/e2e/duitku-sandbox.e2e.spec.ts` and is
      gated by `RUN_DUITKU_SANDBOX_E2E=1`.
- [ ] Running without the flag → file is skipped, no network
      traffic.
- [ ] Running with `RUN_DUITKU_SANDBOX_E2E=1` against live
      sandbox passes all five cases from the machine the task is
      developed on (egress IP works on sandbox by default — prod IP
      allow-list is a separate ops step, research §2.9).
- [ ] `custRefNumber` per test is unique across re-runs.
- [ ] `DUITKU_DISB_SECRET_KEY` never appears in captured test logs.

## Out of scope

- Production IP allow-listing — research §8 item 4 (pre-prod ops
  task).
- Load / concurrency testing against sandbox.
- Any write against production Duitku.
