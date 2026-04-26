# Task 02 — `FLIP_*` env vars + `ConfigService` lookup

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `flip_payout_provider_spec.md` §2.1, §2.2, §4.8

## Why this matters

The adapter can't reach Flip without credentials. Keeping the env
surface minimal and entirely inside `.env.example` + `ConfigService`
means deploy pipelines have one canonical place to source the values,
and the port rule "adapters never read `process.env`" holds.

**Depends on:** nothing — can start immediately, parallel with task 01.

## Scope

Edit `.env.example`:

```bash
# Flip Business — Disbursement
FLIP_SECRET_KEY=           # Secret key from Flip dashboard (HTTP Basic Auth username)
FLIP_VALIDATION_TOKEN=     # Webhook validation token from Flip dashboard
FLIP_API_BASE=https://bigflip.id/big_sandbox_api/v2   # Sandbox default; prod = https://bigflip.id/api/v2
```

Edit the NestJS config layer (wherever the existing Xendit/Duitku env
keys are declared — likely `src/config/` or a module-local
`configuration` factory):

- Register the three keys with typed validation if the project uses
  `@nestjs/config` `validationSchema` (Joi/Zod). Otherwise just ensure
  `ConfigService.getOrThrow` finds them.
- `FLIP_SECRET_KEY` validates as a non-empty string.
- `FLIP_VALIDATION_TOKEN` validates as a non-empty string.
- `FLIP_API_BASE` validates as a URL; default to the sandbox base for
  dev, require explicit override in prod.

If the project has a `getSafeConfig()` or similar helper that
sanitizes secrets for logging, add `FLIP_SECRET_KEY` and
`FLIP_VALIDATION_TOKEN` to the redaction list.

## Rules (non-negotiable)

- **Never log `FLIP_SECRET_KEY` or `FLIP_VALIDATION_TOKEN`.** If the
  config layer has a dump-on-boot debug log, both must be redacted —
  same discipline as Xendit/Duitku secrets.
- **`ConfigService.getOrThrow`, not `get`.** A misconfigured prod
  deploy should fail fast on boot, not on first payout attempt.
- **Sandbox API base in dev, prod base in prod — no runtime toggle.**
  The env value is the source of truth. Do not add an
  `if (NODE_ENV === "production")` branch that picks the base.
- **Do not bake sandbox creds into `.env.example`.** Those are for
  local testing only; `.env.example` ships with empty values.

## Acceptance

- [ ] `.env.example` contains the three `FLIP_*` keys with comments
      matching spec §4.8.
- [ ] Config-layer validation rejects missing/invalid values at boot.
- [ ] If a config-redaction list exists, `FLIP_SECRET_KEY` and
      `FLIP_VALIDATION_TOKEN` are on it.
- [ ] `pnpm run start:dev` with all three values set in `.env` boots
      without errors.

## Out of scope

- Actual prod secret provisioning — ops task, not a code task.
- Webhook-Signature HMAC key — deferred (spec §14 open question 3).
