# Task 18 — `checkBalance` ops helper

**Status:** Not taken (optional — unblock before prod launch if ops needs a live balance read)
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.3 ("Check Balance | `/checkbalance` | optional ops helper"), §2.4 (signature formula), §2.6 (response-code taxonomy)

## Why this matters

Duitku's transfer endpoint fails with `-510 Insufficient merchant funds`
when our master balance runs out. By the time we see `-510` on a
transfer, we've already disappointed an intent. An ops-facing
`checkBalance` endpoint lets the dashboard (or a cron) read the
current master balance proactively and alert **before** the failure
lands on a user. Research §2.3 calls this out as optional — it is
genuinely optional for a soft launch, but should ship before any
material disbursement volume.

**Depends on:** tasks 05 (signature helper), 06 (adapter skeleton),
10 (env wiring).

## Scope

Extend `DuitkuPayoutProvider` with an internal method (not part of
the `IPayoutProviderAdapter` port — this is Duitku-specific ops):

```ts
// on DuitkuPayoutProvider
async checkBalance(): Promise<{ balance: number; currency: "IDR" }>;
```

- POST `${apiBase}/checkbalance` with `{ userId, email, timestamp,
  signature }` using
  `buildSignature("checkBalance", { email, timestamp, secretKey })`.
- Map response to `{ balance, currency: "IDR" }`. Research §2.4
  groups `checkBalance` and `listBank` under the same signature
  formula (`email + timestamp + secretKey`), so the existing helper
  covers it.
- Error codes per §2.6: `-191` / `-213` / `-930` / `-960` → throw
  `PayoutProviderError({ kind: "client_error" })` (adapter-config bug);
  `-951` / `-952` → `server_error`.

Expose via a Duitku-scoped ops controller (not a generic port method).
Two acceptable shapes — pick one:

1. **Admin-only HTTP endpoint:** `GET /admin/payout/duitku/balance`,
   guarded by the existing admin auth. Returns `{ balance, currency }`.
2. **CLI-style internal script:** `src/scripts/payout/duitku-balance.ts`
   that boots the Nest context, calls `checkBalance`, and logs the
   result. Useful for cron / observability pipelines.

Whichever ships first is fine. Do not build both at once — pick the
one ops wants.

## Rules (non-negotiable)

- **Not part of the port interface.** `IPayoutProviderAdapter` has
  three methods (`triggerPayout`, `getStatus`,
  `verifyWebhookSignature`). Adding `checkBalance` to the port would
  force the Xendit adapter to implement it too — a leaky abstraction
  for a provider-specific ops feature. Keep `checkBalance` on the
  concrete `DuitkuPayoutProvider` class and type the consumer against
  the concrete class.
- **Admin-auth gate.** If exposed over HTTP, use the existing
  admin-auth mechanism (`@Roles(UserRole.ADMIN)` or equivalent).
  Never `@Public()`. The balance is not secret, but it's not
  public-internet material either.
- **Do not cache aggressively.** Duitku's balance endpoint is cheap;
  a 10–30s Valkey TTL is fine. Never cache longer than 60s — the
  whole point is an up-to-date read.
- **Log result at `info`** with `{ balance, currency }`; secrets and
  signatures redacted per the adapter's existing discipline.

## Acceptance

- [ ] `DuitkuPayoutProvider.checkBalance()` exists and returns
      `{ balance, currency: "IDR" }` on `responseCode: "00"`.
- [ ] Signature uses `buildSignature("checkBalance", …)` from task 05
      — no ad-hoc hash construction inside this method.
- [ ] Error response codes from §2.6 are mapped to typed
      `PayoutProviderError` kinds.
- [ ] Either an admin-guarded HTTP endpoint **or** a CLI script
      exposes the method to ops — not both at once.
- [ ] Unit test with a mocked transport asserts happy-path mapping
      and one error-code path.
- [ ] `pnpm run build` + `pnpm run test` green.

## Out of scope

- `listBank` helper — research §2.3 lists it as optional, but task
  11 deliberately does not live-call it (seed is a static mapping).
  If ops needs a drift check, file a follow-up task.
- Alerting / threshold policy — downstream ops concern. This task
  exposes the read; cron + alerting live in the ops repo.
- Exposing balance to merchants — master balance is ours, not
  theirs. Merchant-facing balance is an entirely separate concept.
