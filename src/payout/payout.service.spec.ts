import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../prisma/prisma.service";
import { encryptAccountNumber } from "./account-number-crypto";
import { PayoutService } from "./payout.service";
import type { IPayoutProviderAdapter } from "./payout-provider.port";
import { PayoutProviderError, type TPayoutReceipt } from "./types";

function prismaStub(opts?: {
  intent?: (PaymentIntent & { merchant: Merchant | null }) | null;
  createResult?: Record<string, unknown>;
}): {
  paymentIntent: { findUnique: jest.Mock };
  providerPayout: { create: jest.Mock };
} {
  const intent =
    opts?.intent === undefined
      ? ({
          id: "pi_01HXYZ",
          merchantId: "mch_123",
          fiatAmountMinor: 15_000,
          fiatCurrency: "IDR",
          merchant: {
            id: "mch_123",
            payoutChannelCode: "GOPAY",
            payoutAccountNumber: encryptAccountNumber("081234567890"),
            payoutAccountHolderName: "Budi Warung",
            payoutProvider: "xendit",
          } as unknown as Merchant,
        } as unknown as PaymentIntent & { merchant: Merchant })
      : opts.intent;
  return {
    paymentIntent: { findUnique: jest.fn(async () => intent) },
    providerPayout: { create: jest.fn(async () => opts?.createResult ?? {}) },
  };
}

function providerStub(
  overrides: Partial<IPayoutProviderAdapter> = {},
): IPayoutProviderAdapter {
  return {
    triggerPayout: jest.fn(async (intent, merchant): Promise<TPayoutReceipt> => ({
      referenceId: intent.id,
      providerPayoutId: "disb_stub",
      status: "PENDING",
      amount: intent.fiatAmountMinor,
      currency: intent.fiatCurrency,
      channelCode: merchant.payoutChannelCode,
      requestedAt: new Date("2026-04-20T10:00:00Z"),
      rawResponse: { id: "disb_stub", status: "PENDING" },
    })),
    getStatus: jest.fn(async () => ({ status: "PENDING" as const })),
    verifyWebhookSignature: jest.fn(() => true),
    ...overrides,
  };
}

function build(
  providerOverrides?: Partial<IPayoutProviderAdapter>,
  prismaOverrides?: Parameters<typeof prismaStub>[0],
) {
  const prisma = prismaStub(prismaOverrides);
  const provider = providerStub(providerOverrides);
  // PayoutService now injects both Xendit + Duitku adapters. For tests
  // that pivot on the Xendit path we reuse the same stub for both — the
  // resolveProvider switch picks by `merchant.payoutProvider`, so tests
  // that don't flip to "duitku" never touch the Duitku stub.
  const duitkuProvider = providerStub();
  const flipProvider = providerStub();
  const svc = new PayoutService(
    prisma as unknown as PrismaService,
    provider,
    duitkuProvider,
    flipProvider,
  );
  return { svc, prisma, provider, duitkuProvider, flipProvider };
}

describe("PayoutService.triggerPayout", () => {
  it("persists a success row after a provider receipt", async () => {
    const { svc, prisma, provider } = build();
    const intent = { id: "pi_01HXYZ", fiatAmountMinor: 15_000, fiatCurrency: "IDR" } as PaymentIntent;
    const merchant = {
      id: "mch_123",
      payoutChannelCode: "GOPAY",
      payoutAccountNumber: encryptAccountNumber("081234567890"),
      payoutAccountHolderName: "Budi Warung",
      payoutProvider: "xendit",
    } as unknown as Merchant;

    const receipt = await svc.triggerPayout(intent, merchant);

    expect(receipt?.providerPayoutId).toBe("disb_stub");
    expect(provider.triggerPayout).toHaveBeenCalledTimes(1);
    expect(prisma.providerPayout.create).toHaveBeenCalledTimes(1);

    const call = prisma.providerPayout.create.mock.calls[0][0];
    expect(call.data.status).toBe("PENDING");
    expect(call.data.intentId).toBe("pi_01HXYZ");
    expect(call.data.providerPayoutId).toBe("disb_stub");
  });

  it("persists a FAILED row when the provider throws a PayoutProviderError", async () => {
    const err = new PayoutProviderError({
      message: "channel not supported",
      kind: "client_error",
      httpStatus: 400,
      rawResponse: { error_code: "CHANNEL_CODE_INVALID" },
    });
    const { svc, prisma } = build({
      triggerPayout: jest.fn(async () => {
        await Promise.resolve();
        throw err;
      }),
    });
    const intent = { id: "pi_01HXYZ", fiatAmountMinor: 15_000, fiatCurrency: "IDR" } as PaymentIntent;
    const merchant = {
      id: "mch_123",
      payoutChannelCode: "BAD",
      payoutAccountNumber: encryptAccountNumber("081234567890"),
      payoutAccountHolderName: "X",
      payoutProvider: "xendit",
    } as unknown as Merchant;

    const receipt = await svc.triggerPayout(intent, merchant);
    expect(receipt).toBeNull();
    expect(prisma.providerPayout.create).toHaveBeenCalledTimes(1);
    const call = prisma.providerPayout.create.mock.calls[0][0];
    expect(call.data.status).toBe("FAILED");
    expect(call.data.providerPayoutId).toBeNull();
    expect(call.data.providerResponseBody).toMatchObject({
      error: "channel not supported",
    });
  });

  it("routes unknown payout providers to the FAILED path without calling the adapter", async () => {
    const { svc, prisma, provider } = build();
    const intent = { id: "pi_01HXYZ", fiatAmountMinor: 15_000, fiatCurrency: "IDR" } as PaymentIntent;
    const merchant = {
      id: "mch_123",
      payoutChannelCode: "GOPAY",
      payoutAccountNumber: encryptAccountNumber("081234567890"),
      payoutAccountHolderName: "X",
      payoutProvider: "wirecard-2003", // unknown key
    } as unknown as Merchant;

    const receipt = await svc.triggerPayout(intent, merchant);
    expect(receipt).toBeNull();
    expect(provider.triggerPayout).not.toHaveBeenCalled();
    const call = prisma.providerPayout.create.mock.calls[0][0];
    expect(call.data.status).toBe("FAILED");
  });
});

describe("PayoutService.trigger (task 24 soft-link shape)", () => {
  it("loads the intent + merchant and delegates to triggerPayout", async () => {
    const { svc, prisma, provider } = build();
    await svc.trigger("pi_01HXYZ");
    expect(prisma.paymentIntent.findUnique).toHaveBeenCalledWith({
      where: { id: "pi_01HXYZ" },
      include: { merchant: true },
    });
    expect(provider.triggerPayout).toHaveBeenCalledTimes(1);
  });

  it("logs + returns when the intent is missing (no throw into the HTTP path)", async () => {
    const { svc, provider } = build(undefined, { intent: null });
    await expect(svc.trigger("pi_missing")).resolves.toBeUndefined();
    expect(provider.triggerPayout).not.toHaveBeenCalled();
  });
});

describe("PayoutService.verifyXenditWebhookSignature", () => {
  it("delegates to the injected provider", () => {
    const verify = jest.fn(() => true);
    const { svc } = build({ verifyWebhookSignature: verify });
    const ok = svc.verifyXenditWebhookSignature(
      { "x-callback-token": "…" },
      "{}",
    );
    expect(ok).toBe(true);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
