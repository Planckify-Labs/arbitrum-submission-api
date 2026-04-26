# Task 03 — `FlipPayoutProvider` class + DI token + `resolveProvider` case

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §4.3, §4.5, §4.9

## Why this matters

The adapter class has to exist before we can fill in the
triggerPayout / getStatus / verifyWebhookSignature logic. This task
is the DI skeleton: class + token + module binding + the single new
`switch` case in `resolveProvider`. Once merged,
`merchant.payoutProvider = "flip"` routes through the new adapter,
even though every method throws `NotImplementedError` until tasks
04–05 flesh them out. Keeps the wiring change reviewable in isolation.

**Depends on:** tasks 01 (channel mapping available), 02 (env vars
available).

## Scope

Create `src/payout/providers/flip-payout.provider.ts`:

- `class FlipPayoutProvider implements IPayoutProviderAdapter`.
- `@Injectable()`. Constructor injects `ConfigService` (and whatever
  transport/fetch wrapper the existing adapters use — keep parity).
- `triggerPayout` / `getStatus` throw
  `new Error("NotImplemented")` for the skeleton.
- `verifyWebhookSignature` throws `new Error("NotImplemented")` —
  unlike Duitku (which returns `false` because it has no callback),
  Flip **does** have callbacks, so this gets a real implementation in
  task 08.
- Private `requireConfig()` that reads `FLIP_SECRET_KEY`,
  `FLIP_VALIDATION_TOKEN`, `FLIP_API_BASE` via
  `ConfigService.getOrThrow` and returns a typed shape.
- Private `buildAuthHeader()` that constructs the HTTP Basic Auth
  value: `Basic ${Buffer.from(`${secretKey}:`, "utf8").toString("base64")}`.
  The trailing colon before encoding is critical (spec §2.3).
- Private `buildFormBody(params)` that serializes to
  `application/x-www-form-urlencoded` using `URLSearchParams`
  (spec §4.5).
- Do **not** read `process.env` directly — port rule.

Edit `src/payout/payout-provider.port.ts`:

- Add `export const PAYOUT_PROVIDER_FLIP =
  Symbol("PAYOUT_PROVIDER_FLIP");` next to the existing Xendit and
  Duitku tokens.

Edit `src/payout/payout.module.ts`:

- Add `FlipPayoutProvider` to `providers`.
- Bind the token: `{ provide: PAYOUT_PROVIDER_FLIP, useExisting:
  FlipPayoutProvider }` (match the Xendit/Duitku binding style).

Edit `src/payout/payout.service.ts`:

- Inject `@Inject(PAYOUT_PROVIDER_FLIP) flipProvider:
  IPayoutProviderAdapter`.
- Extend `resolveProvider`:
  ```ts
  switch (key) {
    case "xendit": return this.xenditProvider;
    case "duitku": return this.duitkuProvider;
    case "flip":   return this.flipProvider;
    default:       return null;
  }
  ```

Create `src/payout/providers/flip-payout.provider.spec.ts` with a
single smoke test asserting the class can be instantiated via
`Test.createTestingModule`. Full adapter behavior tests land in task 09.

## Rules (non-negotiable)

- **`resolveProvider` is the only switch.** No caller downstream may
  ever branch on the provider name — port rule 1.
- **Adapter reads env via `ConfigService`, never `process.env`.**
- **Do not implement `triggerPayout` / `getStatus` /
  `verifyWebhookSignature` here.** This task is the wiring; the logic
  is split across tasks 04–05, 08 to keep each merge reviewable.
- **The trailing colon in Basic auth is critical.** `base64("KEY:")` not
  `base64("KEY")` — Flip rejects requests without it (spec §2.3).
- **`buildFormBody` uses `URLSearchParams`, not manual string concat.**
  Proper encoding of special characters matters.
- **Do not rename the Xendit or Duitku adapters** in this task.

## Acceptance

- [ ] `FlipPayoutProvider` class compiles and implements
      `IPayoutProviderAdapter`.
- [ ] `PAYOUT_PROVIDER_FLIP` Symbol exported from the port file.
- [ ] `PayoutModule` registers the provider and binds the token.
- [ ] `PayoutService.resolveProvider` returns the Flip adapter when
      `merchant.payoutProvider === "flip"`.
- [ ] `buildAuthHeader()` produces correct Basic auth with trailing
      colon (e.g. `Basic c2VjcmV0Og==` for key `"secret"`).
- [ ] `buildFormBody()` produces valid URL-encoded strings.
- [ ] `triggerPayout`, `getStatus`, `verifyWebhookSignature` throw
      `NotImplemented` (stub).
- [ ] `pnpm run build` green.
- [ ] Smoke spec for the adapter module loads without DI errors.

## Out of scope

- `triggerPayout` body — task 04.
- `getStatus` body — task 05.
- Retry discipline — task 06.
- `verifyWebhookSignature` body — task 08.
- Full adapter unit tests — task 09.
