import type { ZerionClient } from "../external/zerion/zerion.client";
import type { NotificationPreferencesService } from "../push/notification-preferences.service";
import type { PushService } from "../push/push.service";
import {
  digestCopy,
  PortfolioDigestService,
  readPortfolio,
} from "./portfolio-digest.service";

jest.mock("expo-server-sdk", () => ({
  Expo: class {
    static isExpoPushToken() {
      return true;
    }
  },
}));

const portfolio = (positions: number, abs: number, pct: number) => ({
  data: {
    type: "portfolio",
    attributes: {
      total: { positions },
      changes: { absolute_1d: abs, percent_1d: pct },
    },
  },
});

describe("readPortfolio / digestCopy", () => {
  it("reads the three numbers and ignores the client's degraded placeholder", () => {
    expect(readPortfolio(portfolio(1234.56, 38.4, 3.21))).toEqual({
      totalUsd: 1234.56,
      change1dUsd: 38.4,
      change1dPercent: 3.21,
    });
    expect(readPortfolio({ positions: [], totalValue: 0 })).toBeNull();
    expect(readPortfolio(null)).toBeNull();
  });

  it("wording: total first, then the 24h move with its sign", () => {
    expect(
      digestCopy({
        totalUsd: 1234.56,
        change1dUsd: 38.4,
        change1dPercent: 3.21,
      }),
    ).toEqual({
      title: "Portfolio today: $1,234.56",
      body: "Up $38.40 (+3.21%) in the last 24 hours.",
    });
    expect(
      digestCopy({ totalUsd: 900, change1dUsd: -12.5, change1dPercent: -1.37 }),
    ).toEqual({
      title: "Portfolio today: $900.00",
      body: "Down $12.50 (−1.37%) in the last 24 hours.",
    });
    expect(
      digestCopy({ totalUsd: 0, change1dUsd: null, change1dPercent: null })
        .body,
    ).toBe("Here's where your wallet stands this morning.");
  });
});

describe("PortfolioDigestService.run", () => {
  it("sends to this hour's opt-ins only, keyed per user per day, and skips wallets Zerion can't price", async () => {
    const zerion = {
      getPortfolio: jest.fn(async (wallet: string) =>
        wallet.startsWith("0x")
          ? portfolio(100, 1, 1)
          : { positions: [], totalValue: 0 },
      ),
    };
    const preferences = {
      digestRecipientsForHour: jest.fn(async (hour: number) =>
        hour === 2
          ? [
              {
                userId: "u1",
                walletAddress: "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045",
              },
              {
                userId: "u2",
                walletAddress:
                  "GABC123DEF456GHI789JKL012MNO345PQR678STU901VWX234YZA567BC",
              },
            ]
          : [],
      ),
    };
    const push = {
      sendToUser: jest.fn(async (_args: Record<string, unknown>) => ({
        attempted: 1,
        notificationLogId: "log",
      })),
    };
    const service = new PortfolioDigestService(
      zerion as unknown as ZerionClient,
      preferences as unknown as NotificationPreferencesService,
      push as unknown as PushService,
    );

    const at2 = new Date("2026-09-19T02:05:00Z");
    expect(await service.run(at2)).toEqual({ sent: 1, skipped: 1 });
    expect(zerion.getPortfolio).toHaveBeenCalledTimes(1);
    expect(zerion.getPortfolio).toHaveBeenCalledWith(
      "0xd8da6bf26964af9d7eed9e03e53415d37aa96045",
    );
    expect(push.sendToUser.mock.calls[0][0]).toMatchObject({
      userId: "u1",
      title: "Portfolio today: $100.00",
      category: "portfolio_digest",
      dedupeKey: "digest:u1:2026-09-19",
      ttlSeconds: 6 * 60 * 60,
    });

    expect(await service.run(new Date("2026-09-19T03:05:00Z"))).toEqual({
      sent: 0,
      skipped: 0,
    });
  });
});
