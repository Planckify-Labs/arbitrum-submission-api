# Onchain Settlement Rail — Task Backlog

This folder contains engineering tasks derived from `../onchain-merchant-settlement-spec.md`.
Each file represents one discrete unit of work from the spec's §4 Design,
§5 Schema, §6 Env, §8 Failure Semantics, §9 Testing, §10 Rollout,
§11/§11a Open Questions & Treasury, and §12 Security sections.

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
| Not started | `01_onchain_settlement_model_istaken_false.md` |
| In progress | `01_onchain_settlement_model_istaken_true.md` |
| Finished    | `01_onchain_settlement_model_istaken_true_isfinish_true.md` |

## Workflow

1. Browse the tasks, pick one that ends with `istaken_false.md`.
2. Claim it by renaming `istaken_false` → `istaken_true`:
   ```
   git mv 01_onchain_settlement_model_istaken_false.md 01_onchain_settlement_model_istaken_true.md
   ```
3. Work on the task. Read the referenced sections of `../onchain-merchant-settlement-spec.md` —
   each task file excerpts only the minimum context needed.
4. When the task is complete and merged, append the `_isfinish_true`
   postfix — do NOT flip `istaken` back to `false`:
   ```
   git mv 01_onchain_settlement_model_istaken_true.md 01_onchain_settlement_model_istaken_true_isfinish_true.md
   ```
   Finished files stay in the folder as a durable record of what shipped.
5. If you abandon a task mid-flight, rename it back to `istaken_false.md`
   (without the `isfinish_true` postfix) so someone else can pick it up.

## Phase ordering

Tasks are numbered by phase. **Do not start a later phase before the
previous phase's exit criteria are green.** Within a phase, tasks with
no interdependencies can run in parallel.

- **Phase 0** (tasks 01–03) — Contract & ABI. Solidity extension, testnet deploy, ABI export. Longest lead time.
- **Phase 1** (tasks 04–08) — Schema migration. New models, column additions/renames, Token & Blockchain additions. No behavior change yet.
- **Phase 2** (tasks 09–12) — Settlement port + nanopay adapter refactor. Introduce `IPaymentSettlementProvider`, wrap existing nanopay, build orchestrator. Behavior-preserving.
- **Phase 3** (tasks 13–15) — Quote signer service. EIP-712 signing, boot-time assertions, intent response enrichment.
- **Phase 4** (tasks 16–21, 29–32) — Onchain adapter + endpoint + supporting logic. `BlockchainVerificationService` refactor, onchain provider, new endpoint, multi-token DTO, quote lifecycle, failure codes, retry queue, env docs.
- **Phase 5** (tasks 22–25, 33, 37) — Tests. Unit, integration, fork-testnet, selector, regression, security invariant coverage.
- **Phase 6** (tasks 26–28, 34, 38) — Staging cutover & ops. Staging flip, monitoring/alerting, treasury reconciliation, sweep tooling, mobile coordination docs.
- **Phase 7** (tasks 35–36) — Post-bake. Per-merchant preference, signer rotation runbook + `previousSigner` grace. Deferred until staging is stable.

## Task map

### Phase 0 — Contract & ABI

| # | File | Title |
|---|---|---|
| 01 | `01_merchant_payment_contract_extension_istaken_false.md` | Solidity: `MerchantPayment` struct + `processMerchantPayment` + EIP-712 |
| 02 | `02_contract_testnet_deploy_istaken_false.md` | Deploy extended contract to Arc testnet + set `backendSigner` |
| 03 | `03_merchant_payment_abi_export_istaken_false.md` | Export merchant-payment ABI to `takumi-wallet-merchant.abi.ts` |

### Phase 1 — Schema Migration

| # | File | Title |
|---|---|---|
| 04 | `04_onchain_settlement_model_istaken_false.md` | Prisma: `OnchainSettlement` model + migration |
| 05 | `05_payment_intent_field_renames_istaken_false.md` | Rename `usdcAmountMicros` → `tokenAmountMinor`, `usdcSourceChainId` → `sourceChainId` |
| 06 | `06_payment_intent_new_columns_istaken_false.md` | Add `sourceTokenId`, `platformFeeAmountMinor`, `merchantBackingAmountMinor`, `platformFeeBpsSnapshot`, `quoteSignature` |
| 07 | `07_token_payment_columns_istaken_false.md` | Add `Token.isPaymentEnabled` + `Token.platformFeeBps` |
| 08 | `08_blockchain_settlement_columns_istaken_false.md` | Add `Blockchain.takumiWalletContract`, `quoteSignerAddress`, `minConfirmations` |

### Phase 2 — Settlement Port + Nanopay Adapter Refactor

| # | File | Title |
|---|---|---|
| 09 | `09_settlement_provider_port_istaken_false.md` | Define `IPaymentSettlementProvider` port + types + Symbol tokens |
| 10 | `10_nanopay_settlement_adapter_istaken_false.md` | Wrap existing `IntentsService.submitNanopay` into `NanopaySettlementProvider` |
| 11 | `11_settlement_orchestrator_service_istaken_false.md` | `SettlementOrchestratorService` with `resolveProvider` factory |
| 12 | `12_settlement_module_wiring_istaken_false.md` | `SettlementModule` DI registration + integrate with `IntentsService` |

### Phase 3 — Quote Signer Service

| # | File | Title |
|---|---|---|
| 13 | `13_quote_signer_service_istaken_false.md` | `QuoteSignerService` — EIP-712 `QuoteCommitment` signing |
| 14 | `14_boot_time_signer_assertion_istaken_false.md` | Assert `derived(QUOTE_SIGNER_PRIVATE_KEY) === Blockchain.quoteSignerAddress` at boot |
| 15 | `15_intent_response_quote_fields_istaken_false.md` | Add `quoteCommitment` + `quoteSignature` to intent creation response |

### Phase 4 — Onchain Adapter + Endpoint + Supporting Logic

| # | File | Title |
|---|---|---|
| 16 | `16_verify_tx_receipt_only_refactor_istaken_false.md` | Extract `BlockchainVerificationService.verifyTxReceiptOnly` from `verifyTransaction` |
| 17 | `17_verify_merchant_payment_in_contract_istaken_false.md` | Add `BlockchainVerificationService.verifyMerchantPaymentInContract` |
| 18 | `18_onchain_settlement_provider_istaken_false.md` | `OnchainSettlementProvider` adapter implementation |
| 19 | `19_onchain_submit_endpoint_istaken_false.md` | `POST /v1/pay/intents/:id/onchain` controller + DTO |
| 20 | `20_multi_token_intent_dto_istaken_false.md` | Add `sourceTokenId` to `CreateIntentDto` + quote-math widening |
| 21 | `21_platform_fee_quote_math_istaken_false.md` | Platform fee computation at quote time (§4.7a) |
| 29 | `29_abandon_on_refresh_and_quote_sweeper_istaken_false.md` | Abandon-on-refresh + QUOTED intent expiry sweeper (§4.9) |
| 30 | `30_env_var_documentation_istaken_false.md` | Add all new env vars to `.env.example` + ConfigService validation (§6) |
| 31 | `31_failure_code_translation_table_istaken_false.md` | Failure code translation: contract reverts + backend errors → wire codes (§8) |
| 32 | `32_bullmq_retry_insufficient_confirmations_istaken_false.md` | BullMQ re-enqueue for insufficient confirmations (§8.2) |

### Phase 5 — Tests

| # | File | Title |
|---|---|---|
| 22 | `22_onchain_provider_unit_tests_istaken_false.md` | Unit tests for `OnchainSettlementProvider.settle` — all §8 branches |
| 23 | `23_settlement_orchestrator_selector_tests_istaken_false.md` | Selector tests for `SettlementOrchestratorService.resolveProvider` |
| 24 | `24_onchain_e2e_integration_test_istaken_false.md` | E2E: `POST /v1/pay/intents/:id/onchain` → Xendit stub → `PAID_OUT` |
| 25 | `25_nanopay_regression_suite_istaken_false.md` | Verify existing nanopay + payout test suites pass unchanged |
| 33 | `33_fork_testnet_contract_test_istaken_false.md` | Fork-testnet: real `processMerchantPayment` → backend verification (§9 item 3) |
| 37 | `37_security_invariant_test_coverage_istaken_false.md` | Test coverage for all 14 security invariants + attack-tree leaves (§12.2/§12.3) |

### Phase 6 — Staging Cutover & Ops

| # | File | Title |
|---|---|---|
| 26 | `26_staging_env_flip_istaken_false.md` | Flip staging to `PAYMENT_SETTLEMENT_RAIL=onchain` + validate round-trip |
| 27 | `27_monitoring_alerting_setup_istaken_false.md` | Alerts for `BAD_QUOTE` revert spike + `OnchainSettlement` failure rate |
| 28 | `28_treasury_reconciliation_surface_istaken_false.md` | Ops query: outstanding token custody per token + swept amounts |
| 34 | `34_sweep_ops_tooling_istaken_false.md` | Backend/CLI tooling for `sweepPlatformFees` / `sweepMerchantBacking` (§11a item 3) |
| 38 | `38_mobile_coordination_refid_and_quote_consumption_istaken_false.md` | Mobile coordination: refId = intentId + quote consumption docs (§4.5/§4.7/§4.9) |

### Phase 7 — Post-Bake (deferred until staging is stable)

| # | File | Title |
|---|---|---|
| 35 | `35_per_merchant_settlement_preference_istaken_false.md` | Per-merchant settlement rail preference (§4.2 / §10 Phase 6) |
| 36 | `36_signer_rotation_runbook_and_previous_signer_istaken_false.md` | Signer rotation runbook + `previousSigner` contract grace window (§11/§12.5) |

## Source of truth

`../onchain-merchant-settlement-spec.md` is the canonical spec. These task files are a
projection of it — if anything here disagrees with the spec, the spec
wins. Update the spec first, then update the task.
