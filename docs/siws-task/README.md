# SIWS (Sign-In with Solana) — Task Backlog

This folder contains engineering tasks derived from `../SIWS_SPEC.md`.
Each file represents one discrete unit of work from the spec's §3 Design,
§5 Migration & Rollout, and §6 Test Plan sections.

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
| Not started | `01_wallet_address_lower_migration_istaken_false.md` |
| In progress | `01_wallet_address_lower_migration_istaken_true.md` |
| Finished    | `01_wallet_address_lower_migration_istaken_true_isfinish_true.md` |

## Workflow

1. Browse the tasks, pick one that ends with `istaken_false.md`.
2. Claim it by renaming `istaken_false` → `istaken_true`:
   ```
   git mv 01_wallet_address_lower_migration_istaken_false.md 01_wallet_address_lower_migration_istaken_true.md
   ```
3. Work on the task. Read the referenced sections of `../SIWS_SPEC.md` —
   each task file excerpts only the minimum context needed.
4. When the task is complete and merged, append the `_isfinish_true`
   postfix — do NOT flip `istaken` back to `false`:
   ```
   git mv 01_wallet_address_lower_migration_istaken_true.md 01_wallet_address_lower_migration_istaken_true_isfinish_true.md
   ```
   Finished files stay in the folder as a durable record of what shipped.
5. If you abandon a task mid-flight, rename it back to `istaken_false.md`
   (without the `isfinish_true` postfix) so someone else can pick it up.

## Phase ordering

Tasks are numbered by phase. **Do not start a later phase before the
previous phase's exit criteria are green.** Within a phase, tasks with
no interdependencies can run in parallel.

- **Phase 1** (tasks 01–04) — foundations. DB, cache keying, DTO shape, deps. No behavior change yet.
- **Phase 2** (tasks 05–10) — SIWS core. Message builder, verifier, dispatch, endpoints. Behavior-adding.
- **Phase 3** (tasks 11–13) — JWT shape + mobile integration. User-visible change.
- **Phase 4** (tasks 14–16) — tests + case-sensitivity audit. Required before GA.

## Task map

### Phase 1 — Foundations

| # | File | Title |
|---|---|---|
| 01 | `01_wallet_address_lower_migration_istaken_false.md` | `User.walletAddressLower` column + backfill + unique index |
| 02 | `02_nonce_cache_namespace_key_istaken_false.md` | `NonceCacheService.buildKey(namespace, address)` — namespace-aware key |
| 03 | `03_nonce_dto_chain_slug_istaken_false.md` | `NonceDto.chainSlug` + `chainId` mutual exclusion |
| 04 | `04_solana_kit_deps_istaken_false.md` | Install `@solana/keys` + `@solana/addresses` |

### Phase 2 — SIWS core

| # | File | Title |
|---|---|---|
| 05 | `05_siws_message_builder_istaken_false.md` | Canonical `buildSiwsMessage` (server-side) byte-identical to mobile |
| 06 | `06_siws_service_verify_istaken_false.md` | `SiwsService` — parse + ed25519 verify via `@solana/kit` |
| 07 | `07_auth_service_verify_dispatcher_istaken_false.md` | `AuthService.verifySignature` — SIWE/SIWS dispatch |
| 08 | `08_auth_login_namespace_istaken_false.md` | `AuthService.login(address, namespace)` — namespace-aware upsert/lookup |
| 09 | `09_auth_controller_nonce_endpoint_istaken_false.md` | `GET /auth/nonce/:walletAddress` — namespace inference via `chainSlug` |
| 10 | `10_auth_controller_verify_endpoint_istaken_false.md` | `POST /auth/verify` — base58/base64 signature decode, drop EVM-only regex |

### Phase 3 — JWT & mobile

| # | File | Title |
|---|---|---|
| 11 | `11_jwt_address_namespace_istaken_false.md` | JWT payload `addressNamespace: "eip155" \| "solana"` |
| 12 | `12_mobile_use_nonce_namespace_istaken_false.md` | Mobile `useNonce(address, { chainId?, chainSlug? })` |
| 13 | `13_mobile_auth_screen_solana_sign_istaken_false.md` | Mobile `app/auth.tsx` — namespace branch + Solana signer path |

### Phase 4 — Tests + audit

| # | File | Title |
|---|---|---|
| 14 | `14_siws_unit_tests_istaken_false.md` | Unit tests: builder byte-identity + verifier edge cases |
| 15 | `15_siws_integration_roundtrip_istaken_false.md` | Integration: `@solana/kit` keypair round-trip → `/auth/verify` |
| 16 | `16_case_sensitivity_audit_istaken_false.md` | Audit downstream `walletAddress` consumers for lowercase-corruption |

## Source of truth

`../SIWS_SPEC.md` is the canonical spec. These task files are a
projection of it — if anything here disagrees with the spec, the spec
wins. Update the spec first, then update the task.
