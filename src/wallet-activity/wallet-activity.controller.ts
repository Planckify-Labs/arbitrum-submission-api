import { createHash } from "node:crypto";
import { InjectQueue } from "@nestjs/bullmq";
import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Queue } from "bullmq";
import type { Request } from "express";
import { Public } from "../decorators/public.decorator";
import {
  WALLET_ACTIVITY_QUEUE,
  type WalletActivityJobData,
} from "./wallet-activity.types";
import type { ZerionCallbackPayload } from "./zerion-callback.types";
import { ZerionWebhookSignatureService } from "./zerion-webhook-signature.service";

/** Path Zerion POSTs to — `${PUBLIC_API_URL}${ZERION_WEBHOOK_PATH}`. */
export const ZERION_WEBHOOK_PATH = "/webhooks/zerion/transactions";

/**
 * `POST /webhooks/zerion/transactions` — Zerion's wallet-activity callback.
 *
 * Public by design (Zerion sends no API key); authenticity is the RSA
 * signature over the raw body. The handler's only job is to get the 200
 * out fast: Zerion retries 5xx/timeouts three times ~20 s apart and then
 * drops the notification, so everything that can take time (device
 * resolution, Activity backfill, Expo) happens on the `wallet-activity`
 * queue. The job id is Zerion's notification id, so a retried delivery
 * de-duplicates at the queue before it ever reaches the handler.
 */
@ApiTags("webhooks")
@Controller("webhooks/zerion")
export class WalletActivityController {
  private readonly logger = new Logger(WalletActivityController.name);

  constructor(
    private readonly signatures: ZerionWebhookSignatureService,
    @InjectQueue(WALLET_ACTIVITY_QUEUE)
    private readonly queue: Queue<WalletActivityJobData>,
  ) {}

  @Post("transactions")
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Zerion transaction-subscription callback (RSA-signed). Queues the event and returns immediately.",
  })
  async handle(
    @Body() body: ZerionCallbackPayload,
    @Headers("x-timestamp") timestamp: string | undefined,
    @Headers("x-signature") signature: string | undefined,
    @Headers("x-certificate-url") certificateUrl: string | undefined,
    @Req() req: RawBodyRequest<Request>,
  ): Promise<{ ok: true; queued: boolean }> {
    if (this.signatures.enabled) {
      const verdict = await this.signatures.verify({
        timestamp,
        signatureB64: signature,
        certificateUrl,
        rawBody: req.rawBody,
      });
      if (!verdict.ok) {
        this.logger.warn(`[zerion-webhook] rejected: ${verdict.reason}`);
        throw new UnauthorizedException({
          message: "Invalid webhook signature.",
          code: "WEBHOOK_SIGNATURE_INVALID",
          reason: verdict.reason,
        });
      }
    }

    const address = body?.data?.attributes?.address?.trim();
    const included = Array.isArray(body?.included) ? body.included : [];
    if (!address || included.length === 0) {
      // Malformed but authentic — acknowledge so Zerion doesn't retry a
      // payload we'll never be able to use.
      this.logger.warn(
        `[zerion-webhook] ignoring payload without address/included (id=${body?.data?.id ?? "?"})`,
      );
      return { ok: true, queued: false };
    }

    const notificationId =
      body.data?.id ??
      createHash("sha1")
        .update(req.rawBody ?? Buffer.from(JSON.stringify(body)))
        .digest("hex");

    try {
      await this.queue.add(
        "callback",
        { kind: "callback", payload: body },
        { jobId: `cb:${notificationId}` },
      );
    } catch (err) {
      // Redis down: a 5xx buys us Zerion's three retries.
      this.logger.error(
        `[zerion-webhook] could not queue notification ${notificationId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw err;
    }
    return { ok: true, queued: true };
  }
}
