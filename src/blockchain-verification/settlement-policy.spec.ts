import {
  SETTLEMENT_BACKOFF_CAP_MS,
  SETTLEMENT_MAX_ATTEMPTS,
  classifySettlementError,
  resolveMinConfirmations,
  settlementBackoffMs,
} from "./settlement-policy";

describe("settlement-policy", () => {
  describe("classifySettlementError — only the chain gets to say 'failed'", () => {
    it.each([
      [
        "receipt reverted",
        "Transaction 0xab was reverted or failed",
        "rejected_reverted",
      ],
      [
        "point deposit reverted",
        "Point deposit transaction 0xab was reverted or failed",
        "rejected_reverted",
      ],
      [
        "record mismatch",
        "Merchant payment amount mismatch: expected 5541189, got 1",
        "rejected_mismatch",
      ],
      [
        "payer mismatch",
        "Point deposit wallet mismatch: expected 0xa, got 0xb",
        "rejected_mismatch",
      ],
      [
        "no log for this intent",
        "Transaction 0xab did not process merchant payment 01M2",
        "rejected_mismatch",
      ],
    ])("%s → %s", (_label, message, expected) => {
      expect(classifySettlementError(new Error(message))).toBe(expected);
    });

    it.each([
      [
        "receipt timeout",
        'Timed out while waiting for transaction with hash "0xab" to be confirmed.',
      ],
      ["chain client missing (our config)", "Unsupported chain ID: 10143"],
      ["rpc down", "HTTP request failed. fetch failed"],
      ["db hiccup", "Can't reach database server"],
      ["solana not yet confirmed", "Account does not exist or has no data"],
      [
        "stellar not yet visible",
        "Stellar merchant payment 01M2 not found on-chain",
      ],
      ["lagging node confirmations", "Insufficient confirmations: 0/1"],
      ["unknown", "something else entirely"],
      ["not an Error", undefined],
    ])("%s → transient (retry in silence)", (_label, message) => {
      const err = message === undefined ? { weird: true } : new Error(message);
      expect(classifySettlementError(err)).toBe("transient");
    });
  });

  describe("resolveMinConfirmations", () => {
    const config = (env: Record<string, string | number | undefined>) => ({
      get: <T>(key: string) => env[key] as T,
    });

    it("prefers the chain's own value, even 0", () => {
      expect(
        resolveMinConfirmations(
          { minConfirmations: 1 },
          config({ MIN_CONFIRMATIONS: 12 }),
        ),
      ).toBe(1);
      expect(
        resolveMinConfirmations(
          { minConfirmations: 0 },
          config({ MIN_CONFIRMATIONS: 12 }),
        ),
      ).toBe(0);
    });

    it("falls back ONCHAIN_MIN_CONFIRMATIONS → MIN_CONFIRMATIONS (strings from env) → 12", () => {
      expect(
        resolveMinConfirmations(
          { minConfirmations: null },
          config({ ONCHAIN_MIN_CONFIRMATIONS: "3", MIN_CONFIRMATIONS: "12" }),
        ),
      ).toBe(3);
      expect(
        resolveMinConfirmations(
          { minConfirmations: null },
          config({ MIN_CONFIRMATIONS: "6" }),
        ),
      ).toBe(6);
      expect(
        resolveMinConfirmations({ minConfirmations: null }, config({})),
      ).toBe(12);
      expect(
        resolveMinConfirmations(
          { minConfirmations: null },
          config({ MIN_CONFIRMATIONS: "abc" }),
        ),
      ).toBe(12);
    });
  });

  describe("settlementBackoffMs — long, capped, ~a day in total", () => {
    it("doubles from 5s and caps at 10 minutes", () => {
      expect(settlementBackoffMs(1)).toBe(5_000);
      expect(settlementBackoffMs(2)).toBe(10_000);
      expect(settlementBackoffMs(3)).toBe(20_000);
      expect(settlementBackoffMs(8)).toBe(SETTLEMENT_BACKOFF_CAP_MS);
      expect(settlementBackoffMs(150)).toBe(SETTLEMENT_BACKOFF_CAP_MS);
    });

    it("the whole budget spans roughly a day", () => {
      let total = 0;
      for (let attempt = 1; attempt < SETTLEMENT_MAX_ATTEMPTS; attempt++) {
        total += settlementBackoffMs(attempt);
      }
      const hours = total / 3_600_000;
      expect(hours).toBeGreaterThan(20);
      expect(hours).toBeLessThan(30);
    });
  });
});
