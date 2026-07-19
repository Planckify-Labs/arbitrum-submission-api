import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { PaymentIntentStatus, ProviderPayoutStatus } from "@generated/prisma";
import type { IPayoutProviderAdapter } from "./payout-provider.port";
import type { PrismaService } from "../prisma/prisma.service";
import {
  mapFlipCallbackStatus,
  mapXenditCallbackStatus,
  WebhookController,
} from "./webhook.controller";

// PushService pulls in expo-server-sdk, which ships pure ESM and isn't
// transformed by Jest's default config. Nothing here ever instantiates
// the real PushService, so a trivial stub avoids Jest ever parsing it.
jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

/**
 * Tests for `POST /webhooks/xendit`. We exercise the controller directly
 * (rather than via supertest) to keep the suite fast and focused on the
 * branching logic — full HTTP wiring is covered by the e2e suite.
 */

type PayoutRow = {
  id: string;
  intentId: string;
  providerPayoutId: string | null;
  referenceId: string;
  status: ProviderPayoutStatus;
  completedAt: Date | null;
  webhookReceivedAt: Date | null;
};

function payoutRowStub(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: "xp_01",
    intentId: "pi_01HXYZ",
    providerPayoutId: "disb_abc123",
    referenceId: "pi_01HXYZ",
    status: ProviderPayoutStatus.PENDING,
    completedAt: null,
    webhookReceivedAt: null,
    ...overrides,
  };
}

function providerStub(
  verifyImpl: IPayoutProviderAdapter["verifyWebhookSignature"] = () => true,
): IPayoutProviderAdapter {
  return {
    triggerPayout: jest.fn(),
    getStatus: jest.fn(),
    verifyWebhookSignature: jest.fn(verifyImpl),
  } as unknown as IPayoutProviderAdapter;
}

function prismaStub(
  opts: {
    findRow?: PayoutRow | null;
  } = {},
) {
  // Typed as `jest.Mock` (not the narrower generic) so `.mock.calls[0][0]`
  // access in individual tests isn't tripped up by ts-jest's tuple
  // inference on the zero-arg factory form.
  const findFirst: jest.Mock = jest.fn(async () => opts.findRow ?? null);
  const payoutUpdate: jest.Mock = jest.fn(async () => ({}));
  const intentUpdate: jest.Mock = jest.fn(async () => ({}));
  const $transaction: jest.Mock = jest.fn((cb: (tx: unknown) => unknown) => {
    return cb({
      providerPayout: { update: payoutUpdate },
      paymentIntent: { update: intentUpdate },
    });
  });
  return {
    mock: {
      providerPayout: { findFirst, update: payoutUpdate },
      paymentIntent: { update: intentUpdate },
      $transaction,
    } as unknown as PrismaService,
    findFirst,
    payoutUpdate,
    intentUpdate,
    $transaction,
  };
}

function build(
  opts: {
    findRow?: PayoutRow | null;
    verifyImpl?: IPayoutProviderAdapter["verifyWebhookSignature"];
    flipVerifyImpl?: IPayoutProviderAdapter["verifyWebhookSignature"];
  } = {},
) {
  const { mock, findFirst, payoutUpdate, intentUpdate, $transaction } =
    prismaStub({ findRow: opts.findRow });
  const provider = providerStub(opts.verifyImpl);
  const flipProvider = providerStub(opts.flipVerifyImpl);
  const pushService = {
    sendPaidOutPush: async () => {},
  } as unknown as import("../push/push.service").PushService;
  const controller = new WebhookController(
    mock,
    pushService,
    provider,
    flipProvider,
  );
  return {
    controller,
    provider,
    flipProvider,
    prisma: mock,
    findFirst,
    payoutUpdate,
    intentUpdate,
    $transaction,
  };
}

describe("WebhookController.handleXenditCallback — auth guards", () => {
  it("throws 401 when x-callback-token is missing", async () => {
    const { controller, provider } = build();
    await expect(
      controller.handleXenditCallback(
        {},
        { id: "disb_abc123", status: "COMPLETED", reference_id: "pi_01HXYZ" },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Never even ran the verifier — missing header short-circuits.
    expect(provider.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("throws 403 when the token mismatches", async () => {
    const { controller } = build({ verifyImpl: () => false });
    await expect(
      controller.handleXenditCallback(
        { "x-callback-token": "wrong-token" },
        { id: "disb_abc123", status: "COMPLETED", reference_id: "pi_01HXYZ" },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("WebhookController.handleXenditCallback — lookup", () => {
  it("throws 404 when the providerPayoutId is unknown", async () => {
    const { controller } = build({ findRow: null });
    await expect(
      controller.handleXenditCallback(
        { "x-callback-token": "ok" },
        { id: "disb_unknown", status: "COMPLETED", reference_id: "pi_???" },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws 404 when the callback body has no id", async () => {
    const { controller } = build();
    await expect(
      controller.handleXenditCallback(
        { "x-callback-token": "ok" },
        { status: "COMPLETED" },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws 403 when the body's reference_id does not match the row", async () => {
    const row = payoutRowStub({ referenceId: "pi_real" });
    const { controller } = build({ findRow: row });
    await expect(
      controller.handleXenditCallback(
        { "x-callback-token": "ok" },
        {
          id: "disb_abc123",
          status: "COMPLETED",
          reference_id: "pi_SPOOF",
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("WebhookController.handleXenditCallback — state transitions", () => {
  it("COMPLETED flips ProviderPayout → COMPLETED and PaymentIntent → PAID_OUT", async () => {
    const row = payoutRowStub();
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleXenditCallback(
      { "x-callback-token": "ok" },
      {
        id: "disb_abc123",
        status: "COMPLETED",
        reference_id: "pi_01HXYZ",
      },
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.COMPLETED,
    });
    expect($transaction).toHaveBeenCalledTimes(1);

    // ProviderPayout row flipped to COMPLETED with completedAt set.
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    const payoutArgs = payoutUpdate.mock.calls[0][0];
    expect(payoutArgs.where).toEqual({ id: row.id });
    expect(payoutArgs.data.status).toBe(ProviderPayoutStatus.COMPLETED);
    expect(payoutArgs.data.completedAt).toBeInstanceOf(Date);
    expect(payoutArgs.data.webhookReceivedAt).toBeInstanceOf(Date);

    // PaymentIntent row flipped to PAID_OUT.
    expect(intentUpdate).toHaveBeenCalledTimes(1);
    expect(intentUpdate.mock.calls[0][0]).toEqual({
      where: { id: row.intentId },
      data: { status: PaymentIntentStatus.PAID_OUT },
    });
  });

  it("FAILED flips only the ProviderPayout row; intent stays SETTLED (no update)", async () => {
    const row = payoutRowStub();
    const { controller, payoutUpdate, intentUpdate } = build({
      findRow: row,
    });
    const result = await controller.handleXenditCallback(
      { "x-callback-token": "ok" },
      {
        id: "disb_abc123",
        status: "FAILED",
        reference_id: "pi_01HXYZ",
        failure_code: "ACCOUNT_NUMBER_INVALID",
      },
    );

    expect(result).toEqual({ ok: true, status: ProviderPayoutStatus.FAILED });
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    expect(payoutUpdate.mock.calls[0][0].data.status).toBe(
      ProviderPayoutStatus.FAILED,
    );
    // No intent mutation on failure — ops handles via task 49 runbook.
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("PENDING / QUEUED only updates ProviderPayout.status without touching the intent", async () => {
    const row = payoutRowStub();
    const { controller, payoutUpdate, intentUpdate } = build({
      findRow: row,
    });
    const result = await controller.handleXenditCallback(
      { "x-callback-token": "ok" },
      {
        id: "disb_abc123",
        status: "PROCESSING",
        reference_id: "pi_01HXYZ",
      },
    );

    expect(result.status).toBe(ProviderPayoutStatus.PROCESSING);
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    expect(payoutUpdate.mock.calls[0][0].data.status).toBe(
      ProviderPayoutStatus.PROCESSING,
    );
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("WebhookController.handleXenditCallback — idempotency", () => {
  it("returns 200 no-op when the row is already in the same status", async () => {
    const row = payoutRowStub({ status: ProviderPayoutStatus.COMPLETED });
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleXenditCallback(
      { "x-callback-token": "ok" },
      {
        id: "disb_abc123",
        status: "COMPLETED",
        reference_id: "pi_01HXYZ",
      },
    );
    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.COMPLETED,
    });
    // No DB writes on idempotent delivery — matters because Xendit retries
    // aggressively and we don't want to fire duplicate push notifications.
    expect($transaction).not.toHaveBeenCalled();
    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("mapXenditCallbackStatus", () => {
  it.each([
    ["COMPLETED", ProviderPayoutStatus.COMPLETED],
    ["completed", ProviderPayoutStatus.COMPLETED],
    ["PAID", ProviderPayoutStatus.COMPLETED],
    ["SUCCEEDED", ProviderPayoutStatus.COMPLETED],
    ["FAILED", ProviderPayoutStatus.FAILED],
    ["EXPIRED", ProviderPayoutStatus.FAILED],
    ["CANCELLED", ProviderPayoutStatus.FAILED],
    ["CANCELED", ProviderPayoutStatus.FAILED],
    ["DECLINED", ProviderPayoutStatus.FAILED],
    ["PROCESSING", ProviderPayoutStatus.PROCESSING],
    ["QUEUED", ProviderPayoutStatus.PROCESSING],
    ["PENDING", ProviderPayoutStatus.PENDING],
    ["", ProviderPayoutStatus.PENDING],
    [undefined, ProviderPayoutStatus.PENDING],
    ["SOMETHING_NEW", ProviderPayoutStatus.PENDING],
  ])("maps %p → %s", (input, expected) => {
    expect(mapXenditCallbackStatus(input)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Flip webhook tests
// ---------------------------------------------------------------------------

/** Helper: build a valid Flip callback body object. */
function flipBody(
  data: Record<string, unknown> = { id: 123, status: "DONE" },
  token = "valid-token",
): Record<string, string> {
  return { data: JSON.stringify(data), token };
}

/** Payout row stub pre-configured for Flip lookups. */
function flipPayoutRowStub(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return payoutRowStub({
    providerPayoutId: "123",
    ...overrides,
  });
}

describe("WebhookController.handleFlipCallback — auth guards", () => {
  it("throws 401 when the token field is missing from the body", async () => {
    const { controller, flipProvider } = build();
    await expect(
      controller.handleFlipCallback(
        {},
        { data: JSON.stringify({ id: 123, status: "DONE" }) },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    // Should never reach the signature verifier.
    expect(flipProvider.verifyWebhookSignature).not.toHaveBeenCalled();
  });

  it("throws 403 when verifyWebhookSignature returns false", async () => {
    const { controller } = build({ flipVerifyImpl: () => false });
    await expect(
      controller.handleFlipCallback({}, flipBody()),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

describe("WebhookController.handleFlipCallback — lookup", () => {
  it("throws 404 when the disbursement id is unknown", async () => {
    const { controller } = build({ findRow: null });
    await expect(
      controller.handleFlipCallback({}, flipBody({ id: 999, status: "DONE" })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it("throws 400 when `id` is missing from data", async () => {
    const { controller } = build();
    await expect(
      controller.handleFlipCallback({}, flipBody({ status: "DONE" })),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws 400 when the `data` field is missing from the body", async () => {
    const { controller } = build();
    await expect(
      controller.handleFlipCallback({}, { token: "valid-token" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("throws 400 when `data` contains malformed JSON", async () => {
    const { controller } = build();
    await expect(
      controller.handleFlipCallback(
        {},
        { data: "not-json{{{", token: "valid-token" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("WebhookController.handleFlipCallback — state transitions", () => {
  it("DONE flips ProviderPayout → COMPLETED and PaymentIntent → PAID_OUT atomically", async () => {
    const row = flipPayoutRowStub();
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleFlipCallback(
      {},
      flipBody({ id: 123, status: "DONE" }),
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.COMPLETED,
    });
    expect($transaction).toHaveBeenCalledTimes(1);

    // ProviderPayout row flipped to COMPLETED with completedAt set.
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    const payoutArgs = payoutUpdate.mock.calls[0][0];
    expect(payoutArgs.where).toEqual({ id: row.id });
    expect(payoutArgs.data.status).toBe(ProviderPayoutStatus.COMPLETED);
    expect(payoutArgs.data.completedAt).toBeInstanceOf(Date);
    expect(payoutArgs.data.webhookReceivedAt).toBeInstanceOf(Date);

    // PaymentIntent row flipped to PAID_OUT.
    expect(intentUpdate).toHaveBeenCalledTimes(1);
    expect(intentUpdate.mock.calls[0][0]).toEqual({
      where: { id: row.intentId },
      data: { status: PaymentIntentStatus.PAID_OUT },
    });
  });

  it("CANCELLED flips ProviderPayout → FAILED; intent is NOT updated", async () => {
    const row = flipPayoutRowStub();
    const { controller, payoutUpdate, intentUpdate } = build({
      findRow: row,
    });
    const result = await controller.handleFlipCallback(
      {},
      flipBody({ id: 123, status: "CANCELLED" }),
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.FAILED,
    });
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    expect(payoutUpdate.mock.calls[0][0].data.status).toBe(
      ProviderPayoutStatus.FAILED,
    );
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("PENDING callback returns 200 no-op (row already PENDING)", async () => {
    const row = flipPayoutRowStub({ status: ProviderPayoutStatus.PENDING });
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleFlipCallback(
      {},
      flipBody({ id: 123, status: "PENDING" }),
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.PENDING,
    });
    // Idempotent — no DB writes because the row is already PENDING.
    expect($transaction).not.toHaveBeenCalled();
    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("WebhookController.handleFlipCallback — idempotency", () => {
  it("returns 200 no-op when the ProviderPayout is already terminal (COMPLETED)", async () => {
    const row = flipPayoutRowStub({
      status: ProviderPayoutStatus.COMPLETED,
    });
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleFlipCallback(
      {},
      flipBody({ id: 123, status: "DONE" }),
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.COMPLETED,
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("returns 200 no-op when the ProviderPayout is already terminal (FAILED)", async () => {
    const row = flipPayoutRowStub({
      status: ProviderPayoutStatus.FAILED,
    });
    const { controller, payoutUpdate, intentUpdate, $transaction } = build({
      findRow: row,
    });
    const result = await controller.handleFlipCallback(
      {},
      flipBody({ id: 123, status: "CANCELLED" }),
    );

    expect(result).toEqual({
      ok: true,
      status: ProviderPayoutStatus.FAILED,
    });
    expect($transaction).not.toHaveBeenCalled();
    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("mapFlipCallbackStatus", () => {
  it.each([
    ["DONE", ProviderPayoutStatus.COMPLETED],
    ["done", ProviderPayoutStatus.COMPLETED],
    ["CANCELLED", ProviderPayoutStatus.FAILED],
    ["PENDING", ProviderPayoutStatus.PENDING],
    [undefined, ProviderPayoutStatus.PENDING],
    ["SOMETHING_UNKNOWN", ProviderPayoutStatus.PENDING],
  ])("maps %p → %s", (input, expected) => {
    expect(mapFlipCallbackStatus(input)).toBe(expected);
  });
});
