import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  NotFoundException,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  PaymentIntentStatus,
  ProviderPayoutStatus,
} from "@generated/prisma";
import { Public } from "../decorators/public.decorator";
import { PrismaService } from "../prisma/prisma.service";
import { PushService } from "../push/push.service";
import {
  PAYOUT_PROVIDER_FLIP,
  PAYOUT_PROVIDER_XENDIT,
  type IPayoutProviderAdapter,
} from "./payout-provider.port";

/**
 * `POST /webhooks/xendit` — Xendit disbursement callback handler (task 30).
 *
 * Authorization: the endpoint is **public** (no JWT) — Xendit's edge cannot
 * mint one of our SIWE tokens. Authenticity is proven by a static shared
 * secret in the `x-callback-token` header, compared constant-time against
 * `XENDIT_WEBHOOK_TOKEN` (task 29's `verifyWebhookSignature`). That's the
 * scheme Xendit uses today — they do NOT HMAC the body, so the raw body
 * bytes aren't load-bearing and we can let Nest parse JSON normally.
 *
 * Flow (spec §6.4, §9):
 *   1. Guard: reject `401` if `x-callback-token` header is missing —
 *      fail-closed on absent credential.
 *   2. Guard: reject `403` if the token mismatches the configured value.
 *   3. Look up the `ProviderPayout` row by the callback's `id` (Xendit's
 *      provider-side id). `404` if unknown — either a replay against a
 *      deleted row or a spoofed payload that slipped the token check
 *      during rotation.
 *   4. Replay protection (defense-in-depth against token leaks): verify
 *      the row's `referenceId` matches the callback's `reference_id` —
 *      we never changed the reference after POSTing, so a mismatch means
 *      the attacker re-used the leaked token with a crafted id/ref pair
 *      that wasn't part of our outbound call. `403`.
 *   5. Idempotency: if the row is already in the same terminal status
 *      the callback asks for, short-circuit with 200 (no DB writes, no
 *      push re-fire). Xendit retries webhooks — second PAID delivery on
 *      the same reference must be a no-op.
 *   6. Map the callback status → our enum and persist in a single
 *      transaction together with the intent transition:
 *        COMPLETED → ProviderPayout.COMPLETED + PaymentIntent.PAID_OUT
 *                    + set `completedAt`.
 *        FAILED    → ProviderPayout.FAILED. Intent stays SETTLED for the
 *                    ops runbook (task 49). Spec §12 Q5.
 *        other     → status update only, no intent transition.
 *   7. Respond `200` immediately. Any heavy work (push notifications)
 *      is fire-and-forget via `setImmediate` — webhooks must return fast
 *      or Xendit retries, compounding load.
 *
 * NEVER trust the webhook body for amounts / merchant details. `status`
 * and `id` are the only authoritative fields; everything else is echoed
 * back and could be tampered with downstream.
 */
@Controller("webhooks")
@ApiTags("webhooks")
export class WebhookController {
  private readonly logger = new Logger(WebhookController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    @Inject(PAYOUT_PROVIDER_XENDIT)
    private readonly xenditProvider: IPayoutProviderAdapter,
    @Inject(PAYOUT_PROVIDER_FLIP)
    private readonly flipProvider: IPayoutProviderAdapter,
  ) {}

  @Post("xendit")
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleXenditCallback(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: unknown,
  ): Promise<{ ok: true; status: ProviderPayoutStatus }> {
    // 1. Fail-closed on missing token. We treat absent auth differently
    //    from wrong auth (401 vs 403) so ops dashboards can tell apart
    //    "Xendit misconfigured the callback" from "someone probed us".
    const rawToken = headers["x-callback-token"];
    const hasToken =
      typeof rawToken === "string"
        ? rawToken.length > 0
        : Array.isArray(rawToken) && rawToken.length > 0;
    if (!hasToken) {
      this.logger.warn("Xendit webhook: missing x-callback-token header");
      throw new UnauthorizedException({
        message: "Missing x-callback-token header.",
        code: "WEBHOOK_TOKEN_MISSING",
      });
    }

    // 2. Constant-time compare via the port's verifier. `body` is the
    //    parsed object — Xendit uses a static shared-secret header, not
    //    a body-hash HMAC, so re-serializing here is fine (the port
    //    accepts the string-shape for HMAC-using providers later).
    const bodyForSig = JSON.stringify(body ?? {});
    if (!this.xenditProvider.verifyWebhookSignature(headers, bodyForSig)) {
      this.logger.warn("Xendit webhook: x-callback-token mismatch — 403");
      throw new ForbiddenException({
        message: "Invalid x-callback-token.",
        code: "WEBHOOK_TOKEN_INVALID",
      });
    }

    // Pull the two fields we trust from Xendit: `id` and `status`.
    // Everything else is informational / logged only.
    const payload =
      body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    const providerPayoutId =
      typeof payload.id === "string" ? payload.id : undefined;
    const rawStatus =
      typeof payload.status === "string" ? payload.status : undefined;
    const referenceIdFromBody =
      typeof payload.reference_id === "string"
        ? payload.reference_id
        : undefined;

    if (!providerPayoutId) {
      // Payload shape is off — treat as unknown row since we can't
      // correlate. 404 matches the "unknown id" branch so ops has a
      // single signal to alert on.
      this.logger.warn(
        "Xendit webhook: callback body missing `id`; cannot correlate.",
      );
      throw new NotFoundException({
        message: "Unknown payout id in callback body.",
        code: "PAYOUT_NOT_FOUND",
      });
    }

    // 3. Look up the ProviderPayout row. Filter-at-source — a single query.
    const payoutRow = await this.prisma.providerPayout.findFirst({
      where: { providerPayoutId },
    });
    if (!payoutRow) {
      this.logger.warn(
        `Xendit webhook: unknown providerPayoutId=${providerPayoutId}`,
      );
      throw new NotFoundException({
        message: "Unknown payout id in callback body.",
        code: "PAYOUT_NOT_FOUND",
      });
    }

    // 4. Replay protection. `reference_id` is what WE sent — if the
    //    callback body carries a different value it's either spoof or
    //    corruption. Only enforce when the body supplies the field
    //    (Xendit always does per §6.4, but stay lenient on shape drift).
    if (
      referenceIdFromBody !== undefined &&
      referenceIdFromBody !== payoutRow.referenceId
    ) {
      this.logger.warn(
        `Xendit webhook: reference_id mismatch — body=${referenceIdFromBody} row=${payoutRow.referenceId} providerPayoutId=${providerPayoutId}`,
      );
      throw new ForbiddenException({
        message: "reference_id does not match the recorded payout.",
        code: "WEBHOOK_REFERENCE_MISMATCH",
      });
    }

    // 5. Map the callback status. Unknown values are passed through as
    //    PROCESSING-ish (PENDING) — the webhook will re-deliver on the
    //    real terminal state.
    const nextStatus = mapXenditCallbackStatus(rawStatus);

    // 5a. Idempotency — already in that status, nothing to do.
    if (payoutRow.status === nextStatus) {
      this.logger.log(
        `Xendit webhook: idempotent no-op providerPayoutId=${providerPayoutId} status=${nextStatus}`,
      );
      return { ok: true, status: nextStatus };
    }

    // 6. Persist the transition atomically — the ProviderPayout row and
    //    (on COMPLETED) the PaymentIntent row must flip together. A
    //    partial write would leave mobile polling a SETTLED intent with
    //    a COMPLETED payout behind it.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.providerPayout.update({
        where: { id: payoutRow.id },
        data: {
          status: nextStatus,
          webhookReceivedAt: now,
          completedAt:
            nextStatus === ProviderPayoutStatus.COMPLETED
              ? now
              : payoutRow.completedAt,
          // Stash full callback for dispute debugging (§6.6 comment).
          providerResponseBody: (payload as object) ?? undefined,
        },
      });

      if (nextStatus === ProviderPayoutStatus.COMPLETED) {
        // Intent → PAID_OUT. This is the sole transition that flips it.
        await tx.paymentIntent.update({
          where: { id: payoutRow.intentId },
          data: { status: PaymentIntentStatus.PAID_OUT },
        });
      }
      // On FAILED we deliberately leave PaymentIntent at SETTLED — ops
      // retries via the task 49 refund runbook. The failure banner on
      // mobile comes from the ProviderPayout.status, not the intent
      // status.
    });

    this.logger.log(
      `Xendit webhook applied providerPayoutId=${providerPayoutId} intentId=${payoutRow.intentId} status=${nextStatus}`,
    );

    if (nextStatus === ProviderPayoutStatus.FAILED) {
      // Emit a structured log ops can grep — link to task 49 runbook
      // per the task file acceptance criterion.
      this.logger.error(
        `XENDIT_PAYOUT_DECLINED intentId=${payoutRow.intentId} providerPayoutId=${providerPayoutId} — see task 49 refund runbook.`,
      );
    }

    // 7. Fire-and-forget push notification on PAID_OUT. Task 32's push
    //    service may not exist yet — soft-link via dynamic import so a
    //    missing module is a logged no-op, not a 500. Kept off the hot
    //    path with `setImmediate` so Xendit gets its 200 in <50ms.
    if (nextStatus === ProviderPayoutStatus.COMPLETED) {
      setImmediate(() => {
        void this.firePaidOutPush(payoutRow.intentId);
      });
    }

    return { ok: true, status: nextStatus };
  }

  /**
   * `POST /webhooks/flip` — Flip disbursement callback handler.
   *
   * Flip sends `application/x-www-form-urlencoded` with two fields:
   *   - `data` — JSON-encoded string containing the disbursement object
   *   - `token` — validation token (static shared secret)
   *
   * Two-stage parsing: form-decode → JSON.parse(data).
   */
  @Post("flip")
  @Public()
  @HttpCode(HttpStatus.OK)
  async handleFlipCallback(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: Record<string, string> | string,
  ): Promise<{ ok: true; status: ProviderPayoutStatus }> {
    // Log optional Flip webhook security headers for debugging.
    const webhookId = headers["webhook-id"];
    const webhookTimestamp = headers["webhook-timestamp"];
    if (webhookId || webhookTimestamp) {
      this.logger.debug(
        `Flip webhook headers: Webhook-Id=${webhookId ?? "n/a"} Webhook-Timestamp=${webhookTimestamp ?? "n/a"}`,
      );
    }

    // Stage 1: Extract form fields. Body may arrive as parsed object
    // (NestJS urlencoded parser) or raw string.
    let dataStr: string | undefined;
    let tokenStr: string | undefined;
    if (typeof body === "string") {
      const params = new URLSearchParams(body);
      dataStr = params.get("data") ?? undefined;
      tokenStr = params.get("token") ?? undefined;
    } else if (body && typeof body === "object") {
      dataStr = typeof body.data === "string" ? body.data : undefined;
      tokenStr = typeof body.token === "string" ? body.token : undefined;
    }

    // Token verification (before any DB writes).
    if (!tokenStr) {
      this.logger.warn("Flip webhook: missing token field");
      throw new UnauthorizedException({
        message: "Missing token field in callback body.",
        code: "WEBHOOK_TOKEN_MISSING",
      });
    }

    // Build the raw form body for the signature verifier.
    const rawBodyForSig =
      typeof body === "string"
        ? body
        : new URLSearchParams(body as Record<string, string>).toString();
    if (!this.flipProvider.verifyWebhookSignature(headers, rawBodyForSig)) {
      this.logger.warn("Flip webhook: token mismatch — 403");
      throw new ForbiddenException({
        message: "Invalid token.",
        code: "WEBHOOK_TOKEN_INVALID",
      });
    }

    // Stage 2: Parse the JSON-encoded `data` field.
    if (!dataStr) {
      this.logger.warn("Flip webhook: missing data field");
      throw new BadRequestException({
        message: "Missing data field in callback body.",
        code: "WEBHOOK_DATA_MISSING",
      });
    }

    let disbursement: Record<string, unknown>;
    try {
      disbursement = JSON.parse(dataStr);
    } catch {
      this.logger.warn("Flip webhook: malformed JSON in data field");
      throw new BadRequestException({
        message: "Malformed JSON in data field.",
        code: "WEBHOOK_DATA_INVALID",
      });
    }

    const flipId = disbursement.id;
    const rawStatus =
      typeof disbursement.status === "string"
        ? disbursement.status
        : undefined;

    if (flipId == null) {
      this.logger.warn("Flip webhook: data missing id field");
      throw new BadRequestException({
        message: "Missing id in data.",
        code: "WEBHOOK_DATA_INVALID",
      });
    }

    const providerPayoutId = String(flipId);

    // Look up the ProviderPayout row.
    const payoutRow = await this.prisma.providerPayout.findFirst({
      where: { providerPayoutId, provider: "flip" },
    });
    if (!payoutRow) {
      this.logger.warn(
        `Flip webhook: unknown providerPayoutId=${providerPayoutId}`,
      );
      throw new NotFoundException({
        message: "Unknown payout id in callback data.",
        code: "PAYOUT_NOT_FOUND",
      });
    }

    const nextStatus = mapFlipCallbackStatus(rawStatus);

    // Idempotency — already in that status, nothing to do.
    if (payoutRow.status === nextStatus) {
      this.logger.log(
        `Flip webhook: idempotent no-op providerPayoutId=${providerPayoutId} status=${nextStatus}`,
      );
      return { ok: true, status: nextStatus };
    }

    // Persist the transition atomically.
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.providerPayout.update({
        where: { id: payoutRow.id },
        data: {
          status: nextStatus,
          webhookReceivedAt: now,
          completedAt:
            nextStatus === ProviderPayoutStatus.COMPLETED
              ? now
              : payoutRow.completedAt,
          providerResponseBody: (disbursement as object) ?? undefined,
        },
      });

      if (nextStatus === ProviderPayoutStatus.COMPLETED) {
        await tx.paymentIntent.update({
          where: { id: payoutRow.intentId },
          data: { status: PaymentIntentStatus.PAID_OUT },
        });
      }
    });

    this.logger.log(
      `Flip webhook applied providerPayoutId=${providerPayoutId} intentId=${payoutRow.intentId} status=${nextStatus}`,
    );

    if (nextStatus === ProviderPayoutStatus.FAILED) {
      this.logger.error(
        `FLIP_PAYOUT_DECLINED intentId=${payoutRow.intentId} providerPayoutId=${providerPayoutId}`,
      );
    }

    if (nextStatus === ProviderPayoutStatus.COMPLETED) {
      setImmediate(() => {
        void this.firePaidOutPush(payoutRow.intentId);
      });
    }

    return { ok: true, status: nextStatus };
  }

  /**
   * Soft-linked push — task 32 owns the real implementation. We never
   * import its module directly because task 32 may land after this one
   * and we don't want a compile-time coupling. Any failure is swallowed
   * and logged; the webhook's job is done the moment the DB writes
   * commit.
   */
  private async firePaidOutPush(intentId: string): Promise<void> {
    try {
      await this.pushService.sendPaidOutPush(intentId);
      this.logger.log(`PAID_OUT push fired intentId=${intentId}`);
    } catch (err) {
      this.logger.warn(
        `PAID_OUT push failed intentId=${intentId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

/**
 * Map Xendit's callback `status` onto our `ProviderPayoutStatus` enum.
 * Mirrors the mapping in `XenditPayoutProvider.mapXenditStatus` but
 * returns the Prisma enum directly (the provider returns our coarse
 * `TProviderStatus` which doesn't include PROCESSING as a Prisma value
 * 1:1 — today they match, but keeping the two maps independent means
 * a future Xendit status addition only edits one file at a time).
 *
 * Exported for tests.
 */
export function mapXenditCallbackStatus(
  raw: string | undefined,
): ProviderPayoutStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "COMPLETED":
    case "SUCCEEDED":
    case "PAID":
      return ProviderPayoutStatus.COMPLETED;
    case "PROCESSING":
    case "QUEUED":
      return ProviderPayoutStatus.PROCESSING;
    case "FAILED":
    case "EXPIRED":
    case "CANCELLED":
    case "CANCELED":
    case "DECLINED":
      return ProviderPayoutStatus.FAILED;
    case "PENDING":
    case "":
    default:
      return ProviderPayoutStatus.PENDING;
  }
}

/**
 * Map Flip's callback `status` onto `ProviderPayoutStatus`.
 * Flip has three states: PENDING, DONE, CANCELLED.
 *
 * Exported for tests.
 */
export function mapFlipCallbackStatus(
  raw: string | undefined,
): ProviderPayoutStatus {
  switch ((raw ?? "").toUpperCase()) {
    case "DONE":
      return ProviderPayoutStatus.COMPLETED;
    case "CANCELLED":
      return ProviderPayoutStatus.FAILED;
    case "PENDING":
    case "":
    default:
      return ProviderPayoutStatus.PENDING;
  }
}
