# Duitku Payout Provider — Task Backlog

This folder contains engineering tasks derived from
`../duitku_payout_provider_research.md`. Each file represents one
discrete unit of work from the research doc's §4 Implementation Plan,
§6 Schema Changes, and §7 Testing Plan.

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
| Not started | `01_provider_payout_rename_istaken_false.md` |
| In progress | `01_provider_payout_rename_istaken_true.md` |
| Finished    | `01_provider_payout_rename_istaken_true_isfinish_true.md` |

## Workflow

1. Browse the tasks, pick one that ends with `istaken_false.md`.
2. Claim it by renaming `istaken_false` → `istaken_true`:
   ```
   git mv 01_provider_payout_rename_istaken_false.md 01_provider_payout_rename_istaken_true.md
   ```
3. Work on the task. Read the referenced sections of
   `../duitku_payout_provider_research.md` — each task file excerpts
   only the minimum context needed.
4. When the task is complete and merged, append the `_isfinish_true`
   postfix — do NOT flip `istaken` back to `false`:
   ```
   git mv 01_provider_payout_rename_istaken_true.md 01_provider_payout_rename_istaken_true_isfinish_true.md
   ```
   Finished files stay in the folder as a durable record of what shipped.
5. If you abandon a task mid-flight, rename it back to `istaken_false.md`
   (without the `isfinish_true` postfix) so someone else can pick it up.

## Phase ordering

Tasks are numbered by phase. **Do not start a later phase before the
previous phase's exit criteria are green.** Within a phase, tasks with
no interdependencies can run in parallel.

- **Phase 1** (tasks 01–04) — provider-agnostic refactor. Schema rename, `ProviderChannel` extraction, codemod, DTO aliases. No behavior change — Xendit flow stays wire-identical.
- **Phase 2** (tasks 05–09) — Duitku adapter core. Signature helpers, adapter class, inquiry+transfer flow, `getStatus`, response-code retry discipline. Behavior-adding.
- **Phase 3** (tasks 10–11) — config + seeding. Env vars and `ProviderChannel` seed rows for both providers.
- **Phase 4** (tasks 12–17) — tests + validation. Signature vectors, adapter unit tests, module wiring, migration data-preservation, sandbox e2e, Xendit parity re-run. Required before GA.
- **Phase 5** (task 18) — optional ops. `checkBalance` helper. Not required for launch but should land before meaningful disbursement volume.

## Task map

### Phase 1 — Provider-agnostic refactor

| # | File | Title |
|---|---|---|
| 01 | `01_provider_payout_rename_istaken_false.md` | Rename `XenditPayout` → `ProviderPayout` + `Merchant` columns + enum |
| 02 | `02_provider_channel_extraction_istaken_false.md` | Extract `ProviderChannel` table + backfill Xendit rows |
| 03 | `03_xendit_accessor_codemod_istaken_false.md` | Codemod `xendit*` Prisma accessors / types across `src/` |
| 04 | `04_dto_backcompat_aliases_istaken_false.md` | `@Expose` aliases to preserve outward JSON shape |

### Phase 2 — Duitku adapter core

| # | File | Title |
|---|---|---|
| 05 | `05_duitku_signature_helper_istaken_false.md` | `duitkuSha256` + endpoint-typed signature builders |
| 06 | `06_duitku_provider_skeleton_istaken_false.md` | `DuitkuPayoutProvider` class + DI token + `resolveProvider` case |
| 07 | `07_duitku_trigger_payout_istaken_false.md` | `triggerPayout` — inquiry + transfer + holder-name guard |
| 08 | `08_duitku_get_status_istaken_false.md` | `getStatus` via `inquirystatus` + response-code → status map |
| 09 | `09_duitku_retry_discipline_istaken_false.md` | Response-code retry filter (`TO`/`68`/`-100` never retransmit) |

### Phase 3 — Config + seeding

| # | File | Title |
|---|---|---|
| 10 | `10_duitku_env_wiring_istaken_false.md` | `DUITKU_DISB_*` env vars + `ConfigService` lookup |
| 11 | `11_provider_channel_seed_istaken_false.md` | Seed `ProviderChannel` rows for `xendit` + `duitku` per channel |

### Phase 4 — Tests + validation

| # | File | Title |
|---|---|---|
| 12 | `12_duitku_signature_vectors_istaken_false.md` | SHA256 parity vs Duitku PHP SDK reference vectors |
| 13 | `13_duitku_adapter_unit_tests_istaken_false.md` | Adapter unit tests — happy path, name mismatch, retry, redaction |
| 14 | `14_payout_module_wiring_test_istaken_false.md` | Integration — `resolveProvider` switches per `merchant.payoutProvider` |
| 15 | `15_migration_data_preservation_istaken_false.md` | Snapshot test — rename migration preserves rows + backfills `provider` |
| 16 | `16_duitku_sandbox_e2e_istaken_false.md` | Sandbox e2e (gated `RUN_DUITKU_SANDBOX_E2E=1`) |
| 17 | `17_xendit_parity_rerun_istaken_false.md` | Re-run existing Xendit spec unchanged post-rename |

### Phase 5 — Optional ops

| # | File | Title |
|---|---|---|
| 18 | `18_duitku_check_balance_istaken_false.md` | `checkBalance` ops helper (admin endpoint or CLI script) |

## Spec coverage

Every section of `../duitku_payout_provider_research.md` maps to
either a task in this folder or an explicitly deferred item below.

| Spec section | Tasks | Notes |
|---|---|---|
| §1 Port rules | 06, 07 | Rules surfaced in each adapter task's non-negotiables |
| §2.1 Credentials | 10 | |
| §2.2 Base URLs | 10 | |
| §2.3 Endpoints: inquiry / transfer | 07 | |
| §2.3 Endpoints: inquiryStatus | 08 | |
| §2.3 Endpoints: checkBalance | 18 | Optional per spec |
| §2.3 Endpoints: listBank | 11 | Static mapping; spec says **don't** live-call |
| §2.4 Signature formulas | 05, 12 | |
| §2.5 Transfer flow | 07 | |
| §2.6 Response codes | 07, 08, 09 | |
| §2.7 Channels | 11 | |
| §2.8 Webhook v1 (no callback) | 06 | `verifyWebhookSignature` returns `false` |
| §2.8 Webhook future H2H/Cash-Out | — | Deferred — see below |
| §2.9 Sandbox test data | 16 | |
| §3 Delta vs Xendit | 07, 08, 09 | |
| §4.1 Files to add | 05, 06, 12, 13 | |
| §4.2 Files to edit | 01–04, 06, 10, 11 | |
| §4.3 Adapter contract mapping | 06, 07, 08 | |
| §4.4 Retry discipline | 09 | |
| §4.5 Signature construction | 05 | |
| §4.6 Webhook controller | 06 | v1 no change |
| §5 Env vars | 10 | |
| §6.1 End-state schema | 01, 02 | |
| §6.3 Non-breaking migration | 01, 02 | |
| §6.4 Codemod rename scope | 03 | |
| §6.5 Functional guarantees | 17 | Wire-format parity fixture |
| §7 bullets 1–10 (testing plan) | 12–17 | 1 ↦ 12 / 2–6 ↦ 13 / 7 ↦ 16 / 8 ↦ 14 / 9 ↦ 15 / 10 ↦ 17 |

## Deferred / future work

These items are present in the spec but intentionally **not** part of
the v1 task backlog. Each links to the spec section that defers it so
the deferral is auditable.

| Item | Spec ref | Deferred because |
|---|---|---|
| Per-intent provider override (`payoutProviderOverride` on `PaymentIntent`) | §8 item 1 | Out of scope for v1 — merchant-level provider selection is sufficient at launch |
| DTO field rename deprecation (drop `@Expose` aliases, flip mobile) | §8 item 2 | Follow-up release — task 04 tags aliases with deprecation markers so the follow-up can find them |
| Duitku SNAP API | §8 item 3 | Future evaluation — only matters if BI enforces SNAP for UMKM in 2026 |
| IP allow-listing (egress + callback) | §8 item 4 | Pre-prod ops task, not code — handled via Duitku support |
| Account-number envelope encryption | §8 item 5 | Tracked in `../security_review_needed.md`; Duitku integration doesn't change the stopgap |
| H2H / Cash-Out extension (adds `POST /webhooks/duitku`) | §2.8, §8 item 6 | Out of scope for v1 — RTOL/e-wallet has no callback; when H2H lands, the verifier lives in `duitku-signature.ts` per task 05 |
| `listBank` live ops helper | §2.3 | Static mapping in task 11 is sufficient; add a follow-up only if drift proves to be a real problem |
| Duitku as payment-gateway (inbound) | §9 | Separate adapter family (MD5 auth, form-urlencoded, plain-text callback) — do not try to share a client with disbursement |

## Source of truth

`../duitku_payout_provider_research.md` is the canonical spec. These
task files are a projection of it — if anything here disagrees with
the research doc, the doc wins. Update the doc first, then update the
task.
