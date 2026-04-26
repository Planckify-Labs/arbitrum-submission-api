import type { Merchant, PaymentIntent } from "@generated/prisma";
import type { PrismaService } from "../prisma/prisma.service";
import { encryptAccountNumber } from "./account-number-crypto";
import { PayoutService } from "./payout.service";
import type { IPayoutProviderAdapter } from "./payout-provider.port";
import type { TPayoutReceipt } from "./types";

/**
 * `resolveProvider` routing tests (task 14).
 *
 * Space-docking rule: exactly one switch in the codebase reads
 * `merchant.payoutProvider`. A regression there silently routes
 * Duitku-configured merchants through the Xendit adapter (and vice
 * versa). This suite boots `PayoutService` with two distinct adapter
 * stubs and asserts the routing decision for each `payoutProvider`
 * value — including the unknown-provider error path.
 *
 * Mocks the adapters (not the resolver). Xendit adapter spy + Duitku
 * adapter spy; on each `triggerPayout` we assert which one was invoked
 * AND that the other was never touched.
 */

function makeIntent(): PaymentIntent {
  return {
    id: "pi_01HXYZ",
    fiatAmountMinor: 15_000,
    fiatCurrency: "IDR",
    merchantId: "mch_xyz",
  } as unknown as PaymentIntent;
}
function makeMerchant(provider: string): Merchant {
  return {
    id: "mch_xyz",
    country: "ID",
    payoutChannelCode: "GOPAY",
    payoutAccountNumber: encryptAccountNumber("081234567890"),
    payoutAccountHolderName: "Budi Warung",
    payoutProvider: provider,
  } as unknown as Merchant;
}

function buildReceipt(marker: string): TPayoutReceipt {
  return {
    referenceId: "pi_01HXYZ",
    providerPayoutId: marker,
    status: "COMPLETED",
    amount: 15_000,
    currency: "IDR",
    channelCode: "GOPAY",
    requestedAt: new Date("2026-04-24T00:00:00Z"),
    rawResponse: {},
  };
}

function build() {
  const xendit: IPayoutProviderAdapter = {
    triggerPayout: jest.fn(async () => buildReceipt("XENDIT")),
    getStatus: jest.fn(async () => ({ status: "PENDING" as const })),
    verifyWebhookSignature: jest.fn(() => true),
  };
  const duitku: IPayoutProviderAdapter = {
    triggerPayout: jest.fn(async () => buildReceipt("DUITKU")),
    getStatus: jest.fn(async () => ({ status: "PENDING" as const })),
    verifyWebhookSignature: jest.fn(() => false),
  };
  const flip: IPayoutProviderAdapter = {
    triggerPayout: jest.fn(async () => buildReceipt("FLIP")),
    getStatus: jest.fn(async () => ({ status: "PENDING" as const })),
    verifyWebhookSignature: jest.fn(() => true),
  };
  const prisma = {
    providerPayout: { create: jest.fn(async () => ({})) },
    paymentIntent: { findUnique: jest.fn() },
  } as unknown as PrismaService;
  const svc = new PayoutService(prisma, xendit, duitku, flip);
  return { svc, xendit, duitku, flip, prisma };
}

describe("PayoutService.resolveProvider routing", () => {
  it("merchant.payoutProvider = 'xendit' routes to the Xendit adapter; Duitku untouched", async () => {
    const { svc, xendit, duitku } = build();
    const receipt = await svc.triggerPayout(makeIntent(), makeMerchant("xendit"));
    expect(receipt?.providerPayoutId).toBe("XENDIT");
    expect(xendit.triggerPayout).toHaveBeenCalledTimes(1);
    expect(duitku.triggerPayout).not.toHaveBeenCalled();
  });

  it("merchant.payoutProvider = 'duitku' routes to the Duitku adapter; Xendit untouched", async () => {
    const { svc, xendit, duitku } = build();
    const receipt = await svc.triggerPayout(makeIntent(), makeMerchant("duitku"));
    expect(receipt?.providerPayoutId).toBe("DUITKU");
    expect(duitku.triggerPayout).toHaveBeenCalledTimes(1);
    expect(xendit.triggerPayout).not.toHaveBeenCalled();
  });

  it("unknown provider short-circuits to persistFailure without calling either adapter", async () => {
    const { svc, xendit, duitku, prisma } = build();
    const receipt = await svc.triggerPayout(
      makeIntent(),
      makeMerchant("wirecard-2003"),
    );
    expect(receipt).toBeNull();
    expect(xendit.triggerPayout).not.toHaveBeenCalled();
    expect(duitku.triggerPayout).not.toHaveBeenCalled();
    // Failure row is persisted with `provider` set to the unknown key so
    // ops dashboards can still group — and the audit trail says what the
    // merchant was configured with at the time of failure.
    expect(prisma.providerPayout.create).toHaveBeenCalledTimes(1);
    const call = (prisma.providerPayout.create as jest.Mock).mock.calls[0][0];
    expect(call.data.status).toBe("FAILED");
    expect(call.data.provider).toBe("wirecard-2003");
  });

  it("merchant.payoutProvider = 'flip' routes to the Flip adapter; Xendit and Duitku untouched", async () => {
    const { svc, xendit, duitku, flip } = build();
    const receipt = await svc.triggerPayout(makeIntent(), makeMerchant("flip"));
    expect(receipt?.providerPayoutId).toBe("FLIP");
    expect(flip.triggerPayout).toHaveBeenCalledTimes(1);
    expect(xendit.triggerPayout).not.toHaveBeenCalled();
    expect(duitku.triggerPayout).not.toHaveBeenCalled();
  });

  it("all three providers coexist without interference", async () => {
    const { svc, xendit, duitku, flip } = build();

    const receiptXendit = await svc.triggerPayout(makeIntent(), makeMerchant("xendit"));
    const receiptDuitku = await svc.triggerPayout(makeIntent(), makeMerchant("duitku"));
    const receiptFlip = await svc.triggerPayout(makeIntent(), makeMerchant("flip"));

    expect(receiptXendit?.providerPayoutId).toBe("XENDIT");
    expect(receiptDuitku?.providerPayoutId).toBe("DUITKU");
    expect(receiptFlip?.providerPayoutId).toBe("FLIP");

    expect(xendit.triggerPayout).toHaveBeenCalledTimes(1);
    expect(duitku.triggerPayout).toHaveBeenCalledTimes(1);
    expect(flip.triggerPayout).toHaveBeenCalledTimes(1);
  });
});
