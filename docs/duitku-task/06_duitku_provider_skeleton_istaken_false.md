# Task 06 — `DuitkuPayoutProvider` class + DI token + `resolveProvider` case

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §1 (port rules), §4.1, §4.2, §4.3

## Why this matters

The adapter class has to exist before we can fill in the inquiry /
transfer / getStatus logic. This task is the DI skeleton: class +
token + module binding + the single new `switch` case in
`resolveProvider`. Once merged, `merchant.payoutProvider = "duitku"`
routes through the new adapter, even though every method throws
`NotImplementedError` until tasks 07–09 flesh them out. Keeps the
wiring change reviewable in isolation.

**Depends on:** tasks 01–04 (schema + codemod + DTO aliases stable),
task 05 (signature helper available).

## Scope

Create `src/payout/providers/duitku-payout.provider.ts`:

- `class DuitkuPayoutProvider implements IPayoutProviderAdapter`.
- `@Injectable()`. Constructor injects `ConfigService` and
  `HttpService` (or whatever transport wrapper the Xendit adapter
  uses — keep parity).
- `triggerPayout` / `getStatus` / `verifyWebhookSignature` throw
  `new Error("NotImplemented")` for v1 skeleton. **Only**
  `verifyWebhookSignature` has its final v1 body — return `false`
  unconditionally (RTOL has no callback; research §2.8).
- Private `requireConfig()` that reads `DUITKU_DISB_USER_ID`,
  `DUITKU_DISB_EMAIL`, `DUITKU_DISB_SECRET_KEY`, `DUITKU_DISB_API_BASE`
  via `ConfigService.getOrThrow` and returns a typed shape.
- Do **not** read `process.env` directly — port rule in research §1.

Edit `src/payout/payout-provider.port.ts`:

- Add `export const PAYOUT_PROVIDER_DUITKU =
  Symbol("PAYOUT_PROVIDER_DUITKU");` next to the existing Xendit
  token.

Edit `src/payout/payout.module.ts`:

- Add `DuitkuPayoutProvider` to `providers`.
- Bind the token: `{ provide: PAYOUT_PROVIDER_DUITKU, useExisting:
  DuitkuPayoutProvider }` (or equivalent to the Xendit binding style).

Edit `src/payout/payout.service.ts`:

- Inject `@Inject(PAYOUT_PROVIDER_DUITKU) duitkuProvider:
  IPayoutProviderAdapter`.
- Extend `resolveProvider`:
  ```ts
  switch (merchant.payoutProvider) {
    case "xendit": return this.xenditProvider;
    case "duitku": return this.duitkuProvider;
    default: throw new Error(`Unknown payoutProvider: ${merchant.payoutProvider}`);
  }
  ```

Create `src/payout/providers/duitku-payout.provider.spec.ts` with a
single smoke test asserting the class can be instantiated via
`Test.createTestingModule`. Full adapter behavior tests land in task 13.

## Rules (non-negotiable)

- **`resolveProvider` is the only switch.** No caller downstream may
  ever branch on the provider name — see research §1 port rule 1. If
  you find yourself adding a second switch elsewhere, stop and
  refactor back.
- **Adapter reads env via `ConfigService`, never `process.env`.**
  Port rule 3.
- **Do not implement `triggerPayout` / `getStatus` here.** This task
  is the wiring; the logic is split across tasks 07–09 to keep each
  merge reviewable.
- **`verifyWebhookSignature` returns `false` in v1** — RTOL/e-wallet
  has no callback. Comment the line with a reference to research §2.8
  so future H2H work finds it.
- **Do not rename the Xendit adapter** in this task. It stays
  `XenditPayoutProvider`.

## Acceptance

- [ ] `DuitkuPayoutProvider` class compiles and implements
      `IPayoutProviderAdapter`.
- [ ] `PAYOUT_PROVIDER_DUITKU` Symbol exported from the port file.
- [ ] `PayoutModule` registers the provider and binds the token.
- [ ] `PayoutService.resolveProvider` returns the Duitku adapter when
      `merchant.payoutProvider === "duitku"`.
- [ ] `verifyWebhookSignature` returns `false`.
- [ ] `triggerPayout` and `getStatus` throw `NotImplemented` (stub).
- [ ] `pnpm run build` green.
- [ ] Smoke spec for the adapter module loads without DI errors.

## Out of scope

- `triggerPayout` body — task 07.
- `getStatus` body — task 08.
- Response-code retry filter — task 09.
- Full adapter unit tests — task 13.
