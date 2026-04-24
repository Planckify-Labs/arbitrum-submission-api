# Task 10 — `DUITKU_DISB_*` env vars + `ConfigService` lookup

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `duitku_payout_provider_research.md` §2.1, §5

## Why this matters

The adapter can't reach Duitku without credentials. Keeping the env
surface minimal and entirely inside `.env.example` + `ConfigService`
means deploy pipelines have one canonical place to source the values,
and the port rule "adapters never read `process.env`" holds.

**Depends on:** task 06 (adapter skeleton already calls
`requireConfig()` — this task makes those lookups succeed).

## Scope

Edit `.env.example`:

```bash
# Duitku Disbursement (Online Transfer — RTOL + e-wallet)
DUITKU_DISB_USER_ID=            # integer merchant id (from Duitku)
DUITKU_DISB_EMAIL=              # merchant registered email
DUITKU_DISB_SECRET_KEY=         # SHA256 shared secret — rotate via Duitku dashboard
DUITKU_DISB_API_BASE=https://sandbox.duitku.com/webapi/api/disbursement
# Production: https://passport.duitku.com/webapi/api/disbursement
```

Edit the NestJS config layer (wherever the existing Xendit env keys
are declared — likely `src/config/` or a module-local `configuration`
factory):

- Register the four keys with typed validation if the project uses
  `@nestjs/config` `validationSchema` (Joi/Zod). Otherwise just ensure
  `ConfigService.getOrThrow` finds them.
- `DUITKU_DISB_USER_ID` validates as a positive integer string.
- `DUITKU_DISB_EMAIL` validates as an email.
- `DUITKU_DISB_SECRET_KEY` validates as a non-empty string.
- `DUITKU_DISB_API_BASE` validates as a URL; default to the sandbox
  base for dev, require explicit override in prod.

If the project has a `getSafeConfig()` or similar helper that
sanitizes secrets for logging, add `DUITKU_DISB_SECRET_KEY` to the
redaction list.

## Rules (non-negotiable)

- **Never log `DUITKU_DISB_SECRET_KEY`.** If the config layer has a
  dump-on-boot debug log, secretkey must be redacted there — this is
  the same discipline that applies to `XENDIT_SECRET_KEY`.
- **`ConfigService.getOrThrow`, not `get`.** A misconfigured prod
  deploy should fail fast on boot, not on first payout attempt.
- **Sandbox API base in dev, prod base in prod — no runtime toggle.**
  The env value is the source of truth. Do not add an
  `if (NODE_ENV === "production")` branch that picks the base.
- **Do not bake the sandbox creds from research §2.9 into
  `.env.example`.** Those are for local sandbox tests gated by
  `RUN_DUITKU_SANDBOX_E2E=1` (task 16); `.env.example` ships with
  empty values.

## Acceptance

- [ ] `.env.example` contains the four `DUITKU_DISB_*` keys with
      comments matching research §5.
- [ ] Config-layer validation rejects missing/invalid values at boot.
- [ ] `DuitkuPayoutProvider.requireConfig()` returns typed shape from
      `ConfigService.getOrThrow` with no `process.env` access.
- [ ] If a config-redaction list exists, `DUITKU_DISB_SECRET_KEY` is
      on it.
- [ ] `pnpm run start:dev` with all four values set in `.env` boots
      without errors.

## Out of scope

- Actual prod secret provisioning / IP allow-listing — research §8
  item 4 (pre-prod ops task, not a code task).
- Using Duitku's SNAP API — research §8 item 3 (future).
