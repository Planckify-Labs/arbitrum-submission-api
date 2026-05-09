import type { PrismaService } from "../../prisma/prisma.service";
import { TreasuryReconciliationService } from "./treasury-reconciliation.service";

function buildSvc(rows: Record<string, unknown>[] = []) {
  const prisma = {
    $queryRaw: jest.fn(async () => rows),
  } as unknown as PrismaService;
  return { svc: new TreasuryReconciliationService(prisma), prisma };
}

describe("TreasuryReconciliationService.getOutstandingCustody", () => {
  it("returns empty array when no settled intents", async () => {
    const { svc } = buildSvc([]);
    const out = await svc.getOutstandingCustody();
    expect(out).toEqual([]);
  });

  it("converts numeric raw rows into bigints", async () => {
    const { svc } = buildSvc([
      {
        tokenId: "tk_usdc",
        tokenSymbol: "USDC",
        totalSettledMinor: "1000000",
        totalPlatformFeeMinor: "10000",
        totalMerchantBackingMinor: "990000",
      },
    ]);
    const out = await svc.getOutstandingCustody();
    expect(out[0].totalSettledMinor).toBe(1000000n);
    expect(out[0].totalPlatformFeeMinor).toBe(10000n);
    expect(out[0].totalMerchantBackingMinor).toBe(990000n);
  });
});

describe("TreasuryReconciliationService.getMerchantSettlementTotals", () => {
  it("aggregates per-merchant totals as bigint with intentCount as number", async () => {
    const { svc } = buildSvc([
      {
        merchantId: "mch_a",
        tokenSymbol: "USDC",
        totalSettledMinor: "500000",
        intentCount: 7,
      },
    ]);
    const out = await svc.getMerchantSettlementTotals(new Date());
    expect(out[0].merchantId).toBe("mch_a");
    expect(out[0].totalSettledMinor).toBe(500000n);
    expect(out[0].intentCount).toBe(7);
  });
});
