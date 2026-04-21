import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  PaymentIntentStatus,
  XenditPayoutStatus,
} from "@generated/prisma";
import type { IPayoutProviderAdapter } from "./payout-provider.port";
import type { PrismaService } from "../prisma/prisma.service";
import {
  mapXenditCallbackStatus,
  WebhookController,
} from "./webhook.controller";

/**
 * Tests for `POST /webhooks/xendit`. We exercise the controller directly
 * (rather than via supertest) to keep the suite fast and focused on the
 * branching logic — full HTTP wiring is covered by the e2e suite.
 */

type PayoutRow = {
  id: string;
  intentId: string;
  xenditPayoutId: string | null;
  referenceId: string;
  status: XenditPayoutStatus;
  completedAt: Date | null;
  webhookReceivedAt: Date | null;
};

function payoutRowStub(overrides: Partial<PayoutRow> = {}): PayoutRow {
  return {
    id: "xp_01",
    intentId: "pi_01HXYZ",
    xenditPayoutId: "disb_abc123",
    referenceId: "pi_01HXYZ",
    status: XenditPayoutStatus.PENDING,
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
    verifyWebhookSignature: jest.fn(verifyImpl) as any,
  } as unknown as IPayoutProviderAdapter;
}

function prismaStub(opts: {
  findRow?: PayoutRow | null;
} = {}) {
  // Typed as `jest.Mock` (not the narrower generic) so `.mock.calls[0][0]`
  // access in individual tests isn't tripped up by ts-jest's tuple
  // inference on the zero-arg factory form.
  const findFirst: jest.Mock = jest.fn(async () => opts.findRow ?? null);
  const payoutUpdate: jest.Mock = jest.fn(async () => ({}));
  const intentUpdate: jest.Mock = jest.fn(async () => ({}));
  const $transaction: jest.Mock = jest.fn(async (cb: any) => {
    return cb({
      xenditPayout: { update: payoutUpdate },
      paymentIntent: { update: intentUpdate },
    });
  });
  return {
    mock: {
      xenditPayout: { findFirst, update: payoutUpdate },
      paymentIntent: { update: intentUpdate },
      $transaction,
    } as unknown as PrismaService,
    findFirst,
    payoutUpdate,
    intentUpdate,
    $transaction,
  };
}

function build(opts: {
  findRow?: PayoutRow | null;
  verifyImpl?: IPayoutProviderAdapter["verifyWebhookSignature"];
} = {}) {
  const { mock, findFirst, payoutUpdate, intentUpdate, $transaction } =
    prismaStub({ findRow: opts.findRow });
  const provider = providerStub(opts.verifyImpl);
  const controller = new WebhookController(mock, provider);
  return {
    controller,
    provider,
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
  it("throws 404 when the xenditPayoutId is unknown", async () => {
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
  it("COMPLETED flips XenditPayout → COMPLETED and PaymentIntent → PAID_OUT", async () => {
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

    expect(result).toEqual({ ok: true, status: XenditPayoutStatus.COMPLETED });
    expect($transaction).toHaveBeenCalledTimes(1);

    // XenditPayout row flipped to COMPLETED with completedAt set.
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    const payoutArgs = payoutUpdate.mock.calls[0][0];
    expect(payoutArgs.where).toEqual({ id: row.id });
    expect(payoutArgs.data.status).toBe(XenditPayoutStatus.COMPLETED);
    expect(payoutArgs.data.completedAt).toBeInstanceOf(Date);
    expect(payoutArgs.data.webhookReceivedAt).toBeInstanceOf(Date);

    // PaymentIntent row flipped to PAID_OUT.
    expect(intentUpdate).toHaveBeenCalledTimes(1);
    expect(intentUpdate.mock.calls[0][0]).toEqual({
      where: { id: row.intentId },
      data: { status: PaymentIntentStatus.PAID_OUT },
    });
  });

  it("FAILED flips only the XenditPayout row; intent stays SETTLED (no update)", async () => {
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

    expect(result).toEqual({ ok: true, status: XenditPayoutStatus.FAILED });
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    expect(payoutUpdate.mock.calls[0][0].data.status).toBe(
      XenditPayoutStatus.FAILED,
    );
    // No intent mutation on failure — ops handles via task 49 runbook.
    expect(intentUpdate).not.toHaveBeenCalled();
  });

  it("PENDING / QUEUED only updates XenditPayout.status without touching the intent", async () => {
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

    expect(result.status).toBe(XenditPayoutStatus.PROCESSING);
    expect(payoutUpdate).toHaveBeenCalledTimes(1);
    expect(payoutUpdate.mock.calls[0][0].data.status).toBe(
      XenditPayoutStatus.PROCESSING,
    );
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("WebhookController.handleXenditCallback — idempotency", () => {
  it("returns 200 no-op when the row is already in the same status", async () => {
    const row = payoutRowStub({ status: XenditPayoutStatus.COMPLETED });
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
    expect(result).toEqual({ ok: true, status: XenditPayoutStatus.COMPLETED });
    // No DB writes on idempotent delivery — matters because Xendit retries
    // aggressively and we don't want to fire duplicate push notifications.
    expect($transaction).not.toHaveBeenCalled();
    expect(payoutUpdate).not.toHaveBeenCalled();
    expect(intentUpdate).not.toHaveBeenCalled();
  });
});

describe("mapXenditCallbackStatus", () => {
  it.each([
    ["COMPLETED", XenditPayoutStatus.COMPLETED],
    ["completed", XenditPayoutStatus.COMPLETED],
    ["PAID", XenditPayoutStatus.COMPLETED],
    ["SUCCEEDED", XenditPayoutStatus.COMPLETED],
    ["FAILED", XenditPayoutStatus.FAILED],
    ["EXPIRED", XenditPayoutStatus.FAILED],
    ["CANCELLED", XenditPayoutStatus.FAILED],
    ["CANCELED", XenditPayoutStatus.FAILED],
    ["DECLINED", XenditPayoutStatus.FAILED],
    ["PROCESSING", XenditPayoutStatus.PROCESSING],
    ["QUEUED", XenditPayoutStatus.PROCESSING],
    ["PENDING", XenditPayoutStatus.PENDING],
    ["", XenditPayoutStatus.PENDING],
    [undefined, XenditPayoutStatus.PENDING],
    ["SOMETHING_NEW", XenditPayoutStatus.PENDING],
  ])("maps %p → %s", (input, expected) => {
    expect(mapXenditCallbackStatus(input as any)).toBe(expected);
  });
});
