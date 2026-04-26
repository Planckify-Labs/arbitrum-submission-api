# Flip Business Payout Provider — Task Backlog

This folder contains engineering tasks derived from
`../flip_payout_provider_spec.md`. Each file represents one
discrete unit of work from the spec's §4 Implementation Plan,
§5 Status Mapping, and §12 Testing Strategy.

## Filename convention

```
{NN}_{task_name}_istaken_{true|false}[_isfinish_true].md
```

- `NN` — two-digit sequential task number
- `task_name` — short snake_case label
- `istaken_true` / `istaken_false` — whether an engineer is actively working on it
- `_isfinish_true` — appended as a **postfix** once the task is complete.
  A file without this postfix is not yet finished.

Three possible states:

| State | Filename pattern |
|---|---|
| Not started | `01_flip_channels_istaken_false.md` |
| In progress | `01_flip_channels_istaken_true.md` |
| Finished    | `01_flip_channels_istaken_true_isfinish_true.md` |

## Workflow

1. Browse the tasks, pick one that ends with `istaken_false.md`.
2. Claim it by renaming `istaken_false` → `istaken_true`:
   ```
   git mv 01_flip_channels_istaken_false.md 01_flip_channels_istaken_true.md
   ```
3. Work on the task. Read the referenced sections of
   `../flip_payout_provider_spec.md` — each task file excerpts
   only the minimum context needed.
4. When the task is complete and merged, append the `_isfinish_true`
   postfix — do NOT flip `istaken` back to `false`:
   ```
   git mv 01_flip_channels_istaken_true.md 01_flip_channels_istaken_true_isfinish_true.md
   ```
   Finished files stay in the folder as a durable record of what shipped.
5. If you abandon a task mid-flight, rename it back to `istaken_false.md`
   (without the `isfinish_true` postfix) so someone else can pick it up.

## Prerequisites

The Duitku task backlog (`../duitku-task/`) completed the provider-agnostic
refactor (Phase 1: `ProviderPayout` rename, `ProviderChannel` extraction,
codemod, DTO aliases). Those foundations are already in place. This backlog
starts directly from adapter implementation.

## Phase ordering

Tasks are numbered by phase. **Do not start a later phase before the
previous phase's exit criteria are green.** Within a phase, tasks with
no interdependencies can run in parallel.

- **Phase 1** (tasks 01–02) — channel mapping + env config. Foundation data and credentials needed by the adapter.
- **Phase 2** (tasks 03–06) — Flip adapter core. Provider skeleton, `triggerPayout`, `getStatus` (incl. idempotency-key reconcile fallback), retry discipline. Behavior-adding.
- **Phase 3** (tasks 07–08) — webhook. Endpoint + signature verification for Flip's form-urlencoded callbacks.
- **Phase 4** (tasks 09–13) — tests + validation. Unit tests, webhook tests, module wiring, sandbox e2e, existing provider parity.
- **Phase 5** (task 14) — channel seed. Seed `ProviderChannel` rows for Flip alongside existing Xendit + Duitku rows.
- **Phase 6** (tasks 15–16) — optional ops + rollout. Balance check helper and production rollout checklist. Not required for code merge but required before GA.

## Task map

### Phase 1 — Channel mapping + env config

| # | File | Title |
|---|---|---|
| 01 | `01_flip_channels_istaken_false.md` | Create `flip-channels.ts` canonical → Flip bank code mapping |
| 02 | `02_flip_env_wiring_istaken_false.md` | `FLIP_*` env vars + `ConfigService` lookup |

### Phase 2 — Flip adapter core

| # | File | Title |
|---|---|---|
| 03 | `03_flip_provider_skeleton_istaken_false.md` | `FlipPayoutProvider` class + DI token + `resolveProvider` case |
| 04 | `04_flip_trigger_payout_istaken_false.md` | `triggerPayout` — form-urlencoded disbursement + idempotency |
| 05 | `05_flip_get_status_istaken_false.md` | `getStatus` via `GET /disbursement/{id}` + idempotency-key fallback + status mapping |
| 06 | `06_flip_retry_discipline_istaken_false.md` | Retry discipline — exponential backoff, 4xx terminal, timeout handling |

### Phase 3 — Webhook

| # | File | Title |
|---|---|---|
| 07 | `07_flip_webhook_endpoint_istaken_false.md` | `POST /webhooks/flip` endpoint with form-urlencoded parsing |
| 08 | `08_flip_webhook_signature_istaken_false.md` | `verifyWebhookSignature` — token + optional HMAC verification |

### Phase 4 — Tests + validation

| # | File | Title |
|---|---|---|
| 09 | `09_flip_adapter_unit_tests_istaken_false.md` | Adapter unit tests — happy path, errors, serialization, remark truncation |
| 10 | `10_flip_webhook_tests_istaken_false.md` | Webhook controller tests — token verification, status mapping, idempotency |
| 11 | `11_flip_module_wiring_test_istaken_false.md` | Integration — `resolveProvider` switches to Flip per `merchant.payoutProvider` |
| 12 | `12_flip_sandbox_e2e_istaken_false.md` | Sandbox e2e (gated `RUN_FLIP_SANDBOX_E2E=1`) |
| 13 | `13_existing_provider_parity_istaken_false.md` | Re-run existing Xendit + Duitku specs unchanged post-wiring |

### Phase 5 — Channel seed

| # | File | Title |
|---|---|---|
| 14 | `14_flip_provider_channel_seed_istaken_false.md` | Seed `ProviderChannel` rows for `flip` per channel |

### Phase 6 — Optional ops + rollout

| # | File | Title |
|---|---|---|
| 15 | `15_flip_check_balance_istaken_false.md` | `checkBalance` ops helper (`GET /general/balance`) |
| 16 | `16_flip_rollout_checklist_istaken_false.md` | Rollout checklist — merchant config + verification + rollback plan |

## Spec coverage

Every section of `../flip_payout_provider_spec.md` maps to
either a task in this folder or an explicitly deferred item below.

| Spec section | Tasks | Notes |
|---|---|---|
| §1 Motivation | — | Context only, no code task |
| §2.1 Credentials | 02 | Secret key + validation token |
| §2.2 Base URLs | 02 | Sandbox + prod base URL |
| §2.3 Authentication | 03, 04 | Basic auth construction with trailing colon |
| §2.4 Endpoints: Create Disbursement | 04 | `POST /disbursement` |
| §2.4 Endpoints: Get Disbursement by ID | 05 | `GET /disbursement/{id}` |
| §2.4 Endpoints: Get Disbursement by Idempotency Key | 05 | `GET /disbursement?idempotency_key={key}` — reconcile fallback |
| §2.4 Endpoints: Bank Account Inquiry | — | Deferred — optional pre-check |
| §2.4 Endpoints: Get Balance | 15 | `GET /general/balance` — ops helper |
| §2.4 Endpoints: Get Banks | 14 | Static seed; no live call |
| §2.4 Endpoints: Check Maintenance | — | Deferred — circuit-breaker input |
| §2.5 Create Disbursement request/response | 04 | Form-urlencoded body + response mapping |
| §2.6 Transaction Status Values | 04, 05, 07 | PENDING/DONE/CANCELLED → TProviderStatus |
| §2.7 Callback / Webhook | 07, 08 | Form-urlencoded body, token verification, retry policy |
| §2.8 Supported Destinations | 01, 14 | Phase 1 channels; full list is reference for expansion |
| §2.9 Error Handling | 04, 06 | 401/422/5xx error mapping + retry discipline |
| §2.10 Sandbox Behavior | 12 | Gated e2e test |
| §3 Delta vs Existing Providers | 04, 07 | Key architectural differences from Xendit/Duitku |
| §4.1 New files | 01, 03 | `flip-channels.ts`, `flip-payout.provider.ts`, spec file |
| §4.2 Modified files | 02, 03, 07 | port, module, service, webhook controller, `.env.example` |
| §4.3 Adapter contract | 03, 04, 05, 08 | `triggerPayout`, `getStatus`, `verifyWebhookSignature` |
| §4.4 Retry discipline | 06 | 60s timeout, exponential backoff, 3 attempts |
| §4.5 Form-urlencoded serialization | 03, 04 | `buildFormBody()` via `URLSearchParams` |
| §4.6 Webhook controller | 07 | `POST /webhooks/flip` with two-stage parsing |
| §4.7 Channel code mapping + seed | 01, 14 | Phase 1 mapping + seed script |
| §4.8 Environment variables | 02 | `FLIP_SECRET_KEY`, `FLIP_VALIDATION_TOKEN`, `FLIP_API_BASE` |
| §4.9 DI wiring | 03 | `PAYOUT_PROVIDER_FLIP` symbol + module + service |
| §5.1 Disbursement → TProviderStatus | 04, 05 | `mapFlipStatus()` |
| §5.2 Webhook → ProviderPayoutStatus | 07 | `mapFlipCallbackStatus()` |
| §6 Remark Truncation | 04 | `intent.id.slice(-18)` |
| §7 Bank Account Inquiry | — | Deferred — see below |
| §8 Reconcile / Polling | 05 | `getStatus` + `getStatusByIdempotencyKey` |
| §9 Fees | 14 | Seed `ProviderChannel.feeIdr` from known fees |
| §10 Maintenance / Circuit Breaker | — | Deferred — see below |
| §11 Security item 1 (secret key never logged) | 03, 04 | `buildAuthHeader()` construction |
| §11 Security item 2 (account number never logged) | 04 | `redactAccountNumber()` |
| §11 Security item 3 (webhook token timingSafeEqual) | 08 | Constant-time comparison |
| §11 Security item 4 (Webhook-Signature HMAC) | — | Deferred — see below |
| §11 Security item 5 (replay protection) | — | Deferred — see below |
| §12.1 Unit tests | 09 | Adapter spec |
| §12.2 Webhook controller tests | 10 | Webhook spec |
| §12.3 Integration testing (sandbox) | 12 | Sandbox e2e |
| §13 Migration / Rollout | 16 | Rollout checklist — merchant config, verification, rollback |
| §14 Open question 1 (e-wallet fees) | 16 | Pre-rollout check item |
| §14 Open question 2 (rate limits) | 16 | Pre-rollout check item |
| §14 Open question 3 (Webhook-Signature scheme) | — | Deferred — see below |
| §14 Open question 4 (Special disbursement PJP) | — | Deferred — see below |
| §14 Open question 5 (timestamps GMT+7) | 16 | Pre-rollout check item |

## Deferred / future work

These items are present in the spec but intentionally **not** part of
the v1 task backlog. Each links to the spec section that defers it so
the deferral is auditable.

| Item | Spec ref | Deferred because |
|---|---|---|
| Bank Account Inquiry (`POST /disbursement/bank-account-inquiry`) | §7 | Optional pre-check; Flip handles validation internally during disbursement. Add as utility method if ops requests it |
| Maintenance / Circuit Breaker (`GET /general/maintenance`) | §10 | v1 logs a warning for degraded banks; full circuit-breaker is a follow-up |
| Fee reconciliation job | §9 | Fees seeded statically in v1; periodic sync with `GET /general/banks` is follow-up |
| Webhook-Signature HMAC verification | §2.7, §11 item 4, §14 item 3 | v1 uses `token` field verification; HMAC scheme (algorithm, signing key, body format) requires confirmation from Flip docs |
| Webhook replay protection (`Webhook-Timestamp` / `Webhook-Id`) | §11 item 5 | v1 logs these headers; reject-if-stale and idempotent-by-webhook-id are follow-ups |
| Special Disbursement (PJP) | §14 item 4 | Separate `/special-disbursement` endpoint for KYC-required transfers; determine if any UMKM merchants need this |
| Flip rate limits | §14 item 2 | Not publicly documented; contact Flip before go-live (captured in task 16 rollout checklist) |
| Additional bank channels beyond Phase 1 | §2.8 | 100+ banks available; expand as merchant demand requires |
| Automated provider failover | §1 | Flip improves redundancy, but automatic failover between providers is a separate architecture effort |

## Source of truth

`../flip_payout_provider_spec.md` is the canonical spec. These
task files are a projection of it — if anything here disagrees with
the spec, the spec wins. Update the spec first, then update the
task.
