import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Post,
  Request,
  UseGuards,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CreateIntentDto } from "./dto/create-intent.dto";
import {
  DepositReceiptDto,
  type DepositReceiptResponseDto,
} from "./dto/deposit-receipt.dto";
import type { NanopaySubmitResponseDto } from "./dto/nanopay-submit-response.dto";
import type { PaymentIntentResponseDto } from "./dto/payment-intent-response.dto";
import { SubmitNanopayDto } from "./dto/submit-nanopay.dto";
import { SubmitNanopaySvmDto } from "./dto/submit-nanopay-svm.dto";
import { OnchainSubmitDto } from "./dto/onchain-submit.dto";
import { IntentsService } from "./intents.service";

/**
 * Minimal request type so we can pull `req.user` without dragging in the
 * whole passport typing. Matches the ad-hoc shape other controllers use
 * (`dapps.controller.ts`, `address-book.controller.ts`).
 */
interface AuthedRequest {
  user?: {
    id: string;
    walletAddress?: string;
  };
}

/**
 * `POST /v1/pay/intents` — scan-to-pay intent creation.
 *
 * Auth: JWT (SIWE-issued). We prefer `req.user.walletAddress` as the
 * authoritative payer address.
 *
 * Stopgap (memory `feedback_role_separation.md`): if the JWT payload
 * doesn't carry a wallet address for some reason (legacy tokens, non-SIWE
 * provider, etc.), we fall back to the `X-Payer-Address` header. This is
 * a controlled degradation — everything else the server computes stays
 * server-side. Once SIWE coverage is universal we can drop the header.
 *
 * Spec refs: umkm-usdc-payout-spec.md §6.2, §6.5, §8.5 #3.
 */
@Controller("pay")
@ApiTags("pay")
@UseGuards(JwtAuthGuard)
export class IntentsController {
  private readonly logger = new Logger(IntentsController.name);

  constructor(private readonly intentsService: IntentsService) {}

  @Post("intents")
  @HttpCode(HttpStatus.CREATED)
  async createIntent(
    @Body() dto: CreateIntentDto,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Headers("x-payer-address") payerAddressHeader: string | undefined,
    @Request() req: AuthedRequest,
  ): Promise<PaymentIntentResponseDto> {
    if (!idempotencyKey) {
      throw new BadRequestException({
        message: "Idempotency-Key header is required.",
        code: "IDEMPOTENCY_KEY_MISSING",
      });
    }
    if (idempotencyKey.length < 32 || idempotencyKey.length > 64) {
      throw new BadRequestException({
        message: "Idempotency-Key must be 32..64 chars.",
        code: "IDEMPOTENCY_KEY_FORMAT",
      });
    }

    // Payer address resolution. JWT first (authoritative); header stopgap
    // only if the token doesn't carry one. We NEVER trust a header-provided
    // address when the JWT already has one — that would let a request
    // override the bound identity. If neither is present, fail fast.
    const payerAddress = req.user?.walletAddress ?? payerAddressHeader;
    if (!payerAddress) {
      // TODO(auth): remove the header stopgap once all production tokens
      // are SIWE-issued and carry `walletAddress` in the payload.
      throw new BadRequestException({
        message:
          "Payer wallet address missing. Authenticate with a SIWE-issued JWT that carries a wallet address, " +
          "or provide `X-Payer-Address` as a stopgap.",
        code: "PAYER_ADDRESS_REQUIRED",
      });
    }
    if (
      req.user?.walletAddress &&
      payerAddressHeader &&
      req.user.walletAddress !== payerAddressHeader
    ) {
      this.logger.warn(
        `X-Payer-Address header ignored because JWT already binds ${req.user.walletAddress}`,
      );
    }

    // Stable hash source for idempotency. We hash the canonical JSON of the
    // DTO (class-validator has already stripped unknown props before this
    // point, so extra client-supplied fields can't poison the hash). Key
    // order is sorted so semantically-identical bodies hash identically
    // even if clients shuffle field order.
    const rawBodyForHash = canonicalJson({
      ...dto,
      // Include the payer so two users sharing an Idempotency-Key don't
      // collide. Mobile-side the key is a fresh random, but we defend
      // against collision anyway.
      payer: payerAddress.toLowerCase(),
    });

    return await this.intentsService.createIntent({
      dto,
      idempotencyKey,
      payerAddress,
      payerUserId: req.user?.id ?? null,
      rawBodyForHash,
    });
  }

  /**
   * `GET /v1/pay/intents/:id` — polling endpoint for the receipt / progress
   * UI (task 25, spec §6.2, §6.3).
   *
   * Read-only: never mutates state. Mobile's `useIntentStatus` polls this
   * every 3 s while the intent is in-flight and stops once `status` is
   * terminal (`paid | paid_out | failed | expired`). Freshness matters
   * more than cacheability, so we set `Cache-Control: no-store` — the
   * polling interval is the only cache layer we want.
   *
   * Auth: same SIWE JWT as the create endpoint. Authorization is narrower,
   * though — only the payer (by userId or wallet address) OR the merchant
   * owner can read. See `IntentsService.getIntent` for the full matrix.
   *
   * Header stopgap: same as task 23. If the JWT doesn't carry a wallet
   * address (legacy token) we fall through to `X-Payer-Address` for
   * authorization matching. This keeps mobile's polling working while
   * the universal SIWE migration lands.
   */
  @Get("intents/:id")
  @HttpCode(HttpStatus.OK)
  @Header("Cache-Control", "no-store")
  async getIntent(
    @Param("id") intentId: string,
    @Headers("x-payer-address") payerAddressHeader: string | undefined,
    @Request() req: AuthedRequest,
  ): Promise<PaymentIntentResponseDto> {
    // Basic id sanity — ULIDs are 26 chars, but we accept any non-empty
    // string and let the DB lookup decide. This keeps us lenient in case
    // the id format evolves (e.g. adds a `pi_` prefix); we don't want a
    // controller-side regex to become the versioning blocker.
    if (!intentId || intentId.length < 8) {
      throw new BadRequestException({
        message: "Intent id is required.",
        code: "INTENT_ID_REQUIRED",
      });
    }

    return await this.intentsService.getIntent({
      intentId,
      userId: req.user?.id ?? null,
      walletAddress: req.user?.walletAddress ?? payerAddressHeader ?? null,
    });
  }

  /**
   * `POST /v1/pay/intents/:id/nanopay` — Circle Gateway x402 settle proxy
   * (task 24, spec §6.2 `NanopaySubmitRequest`, §6.5).
   *
   * Mobile signs the EIP-3009 authorization, POSTs `{ signature }` here,
   * and we proxy to Circle Gateway's `/gateway/v1/x402/settle`. Circle's
   * 200 OK is the "PAID" attestation; we persist it, flip the intent to
   * SETTLED, and fire the Xendit payout (task 29) synchronously.
   *
   * Return shape:
   *   - `{ status: "SETTLED", attestation }`  — Circle accepted.
   *   - `{ status: "FAILED", failure }`       — Circle rejected (body carries mapped `NanopayFailureCode`).
   *   - `{ status: "SETTLING" }`              — our call to Circle timed out; intent is in-flight.
   *
   * Idempotency: resubmitting the same signature for the same intent
   * returns the existing submission row without a second Circle call.
   * The natural dedup key is `(intentId, signature)`.
   *
   * Auth: same JWT as the other pay endpoints. We deliberately do NOT
   * re-enforce the payer/merchant split here — any authenticated caller
   * with the intent id + a valid signature CAN submit (Circle itself is
   * the source of truth on whether the signature is valid; DoS ceiling
   * is the global rate limiter).
   */
  @Post("intents/:id/nanopay")
  @HttpCode(HttpStatus.OK)
  async submitNanopay(
    @Param("id") intentId: string,
    @Body() dto: SubmitNanopayDto,
  ): Promise<NanopaySubmitResponseDto> {
    if (!intentId || intentId.length < 8) {
      throw new BadRequestException({
        message: "Intent id is required.",
        code: "INTENT_ID_REQUIRED",
      });
    }

    // `payload` echo on the DTO is accepted but not trusted (see DTO
    // docstring). We ignore it intentionally — the service rehydrates
    // every Circle-bound field from the persisted intent row.
    return await this.intentsService.submitNanopay({
      intentId,
      signature: dto.signature,
    });
  }

  /**
   * `POST /v1/pay/intents/:id/nanopay-svm` — Solana x402 facilitator proxy
   * (task 43 / spec §5.2.1 Path B-SVM).
   *
   * The Solana twin of `/nanopay` above. Mobile (task 42) signs the
   * pre-built Solana transaction and POSTs the base64 blob here; we forward
   * the opaque string to the facilitator URL configured in
   * `Blockchain.x402FacilitatorUrl` for the SVM chain.
   *
   * The response shape is identical to `/nanopay` — same
   * `NanopaySubmitResponseDto`, same four statuses (`SETTLED` / `FAILED` /
   * `SETTLING`), same `NanopayFailureCode` enum — so mobile receipt /
   * polling code stays rail-agnostic.
   *
   * Gate: the service rejects with `INTENT_WRONG_CHAIN_NAMESPACE` (400) if
   * the targeted intent was minted for EVM. Chain-extension discipline
   * (memory `feedback_chain_extension_discipline.md`) — the endpoint is
   * namespace-fixed; clients that pick the wrong rail get a hard fail
   * instead of silent coercion.
   *
   * RFC: github.com/coinbase/x402/issues/646 — SVM scheme stability. If the
   * wire format drifts pre-M6, the opaque-forward posture limits the blast
   * radius to {@link submitNanopaySvm} + the facilitator URL env.
   */
  @Post("intents/:id/nanopay-svm")
  @HttpCode(HttpStatus.OK)
  async submitNanopaySvm(
    @Param("id") intentId: string,
    @Body() dto: SubmitNanopaySvmDto,
  ): Promise<NanopaySubmitResponseDto> {
    if (!intentId || intentId.length < 8) {
      throw new BadRequestException({
        message: "Intent id is required.",
        code: "INTENT_ID_REQUIRED",
      });
    }

    return await this.intentsService.submitNanopaySvm({
      intentId,
      signedTransaction: dto.signedTransaction,
    });
  }

  /**
   * `POST /v1/pay/intents/:id/onchain` — onchain settlement submit
   * (task 19 / spec §4.4, §4.8).
   *
   * Mobile submits the tx hash + chain ID as soon as the payer's wallet
   * has broadcast a `processMerchantPayment` transaction to the
   * TakumiWalletMerchant contract — it does NOT wait for it to be mined.
   * This handler records the hash and answers `SETTLING` at once; the
   * `onchain-settlement` queue verifies the tx against the chain (Phase
   * A: receipt at the chain's confirmation depth + the intent's log,
   * Phase B: contract-level data match), flips the intent to SETTLED,
   * fires the fiat payout and pushes the result. The client polls
   * `GET /v1/pay/intents/:id` (status `settling` → `paid`) or acts on the
   * push; it is free to leave the screen.
   *
   * Return shape mirrors `/nanopay` — same `NanopaySubmitResponseDto`,
   * same three statuses (`SETTLED` / `FAILED` / `SETTLING`), so mobile
   * receipt / polling code stays rail-agnostic. `SETTLED` is returned
   * only for a hash that was already verified earlier.
   *
   * Idempotency: `(intentId, txHash)` is the natural dedup key (unique
   * index on `onchain_settlements`). A second POST with the same txHash
   * returns the existing row verbatim (200), not a new verification.
   */
  @Post("intents/:id/onchain")
  @HttpCode(HttpStatus.OK)
  async submitOnchain(
    @Param("id") intentId: string,
    @Body() dto: OnchainSubmitDto,
  ): Promise<NanopaySubmitResponseDto> {
    if (!intentId || intentId.length < 8) {
      throw new BadRequestException({
        message: "Intent id is required.",
        code: "INTENT_ID_REQUIRED",
      });
    }
    return await this.intentsService.submitOnchain({
      intentId,
      txHash: dto.txHash,
      blockchainId: dto.blockchainId,
    });
  }

  /**
   * `POST /v1/pay/intents/:id/deposit-receipt` — task 38, spec §6.2.
   *
   * Fired once, on the payer's first Gateway deposit during onboarding.
   * Mobile submits the confirmed tx hash + chain + amount + paymaster
   * flag; the server verifies the tx on-chain (lightweight — status +
   * recipient + sender only), writes a `GatewayDeposit` audit row, and
   * flips the associated intent's `requiresDeposit` to `false` so the
   * Nanopay submit path unblocks.
   *
   * Auth: same JWT as the other pay endpoints. We narrow authorization
   * to the intent's payer inside the service — a merchant owner cannot
   * ack a payer's deposit (see service docstring for the full rationale).
   *
   * Idempotency: `txHash` is the natural dedup key (unique index on
   * `gateway_deposits.txHash`). A second POST with the same txHash
   * returns the existing row verbatim (200), not a new audit entry.
   *
   * Spec refs: umkm-usdc-payout-spec.md §6.2 DepositReceiptRequest,
   * §6.6 gateway_deposits.
   */
  @Post("intents/:id/deposit-receipt")
  @HttpCode(HttpStatus.OK)
  async recordDepositReceipt(
    @Param("id") intentId: string,
    @Body() dto: DepositReceiptDto,
    @Headers("x-payer-address") payerAddressHeader: string | undefined,
    @Request() req: AuthedRequest,
  ): Promise<DepositReceiptResponseDto> {
    if (!intentId || intentId.length < 8) {
      throw new BadRequestException({
        message: "Intent id is required.",
        code: "INTENT_ID_REQUIRED",
      });
    }

    return await this.intentsService.recordDepositReceipt({
      intentId,
      txHash: dto.txHash,
      chainId: dto.chainId,
      amountMicros: dto.amountMicros,
      usedCirclePaymaster: dto.usedCirclePaymaster,
      callerUserId: req.user?.id ?? null,
      callerWalletAddress:
        req.user?.walletAddress ?? payerAddressHeader ?? null,
    });
  }
}

/**
 * Deterministic JSON with sorted keys — required for idempotency hashing
 * to be stable across JS engines & client-side key ordering quirks.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const entries = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    if (v === undefined) return null;
    return `${JSON.stringify(k)}:${canonicalJson(v)}`;
  });
  return `{${entries.filter((e) => e !== null).join(",")}}`;
}
