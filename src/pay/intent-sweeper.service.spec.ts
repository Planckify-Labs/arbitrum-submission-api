import type { PrismaService } from "../prisma/prisma.service";
import { IntentSweeperService } from "./intent-sweeper.service";

describe("IntentSweeperService.sweepExpiredQuotes", () => {
  it("flips QUOTED + expired intents to EXPIRED via updateMany", async () => {
    const prisma = {
      paymentIntent: {
        updateMany: jest.fn(async () => ({ count: 3 })),
      },
    } as unknown as PrismaService;

    const svc = new IntentSweeperService(prisma);
    await svc.sweepExpiredQuotes();

    const args = (prisma.paymentIntent.updateMany as jest.Mock).mock.calls[0][0];
    expect(args.where.status).toBe("QUOTED");
    expect(args.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(args.data).toEqual({ status: "EXPIRED" });
  });

  it("is a no-op when no rows match (count=0, no log)", async () => {
    const prisma = {
      paymentIntent: { updateMany: jest.fn(async () => ({ count: 0 })) },
    } as unknown as PrismaService;
    const svc = new IntentSweeperService(prisma);
    await expect(svc.sweepExpiredQuotes()).resolves.toBeUndefined();
  });
});
