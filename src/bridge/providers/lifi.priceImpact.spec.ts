import { lifiPriceImpactPercent } from "./lifi.adapter";

describe("lifiPriceImpactPercent", () => {
  it("derives a percent from USD in vs out", () => {
    expect(
      lifiPriceImpactPercent({ fromAmountUSD: "1000", toAmountUSD: "970" }),
    ).toBeCloseTo(3, 5);
  });
  it("is unknown, never 0, without USD figures", () => {
    expect(lifiPriceImpactPercent({})).toBeUndefined();
    expect(lifiPriceImpactPercent({ fromAmountUSD: "0", toAmountUSD: "1" })).toBeUndefined();
  });
  it("treats an unpriced output token as unknown, not a 100% loss", () => {
    expect(
      lifiPriceImpactPercent({ fromAmountUSD: "250", toAmountUSD: "0" }),
    ).toBeUndefined();
    expect(
      lifiPriceImpactPercent({ fromAmountUSD: "250", toAmountUSD: "0.00" }),
    ).toBeUndefined();
  });
  it("never goes negative", () => {
    expect(
      lifiPriceImpactPercent({ fromAmountUSD: "100", toAmountUSD: "101" }),
    ).toBe(0);
  });
  it("prefers a provider-reported value", () => {
    expect(lifiPriceImpactPercent({ priceImpact: 1.5, fromAmountUSD: "100", toAmountUSD: "50" })).toBe(1.5);
  });
});

import { towerPriceImpactPercent } from "./tower.adapter";

describe("towerPriceImpactPercent", () => {
  it("converts Tower's basis points to percent", () => {
    expect(towerPriceImpactPercent(14)).toBeCloseTo(0.14, 5);
    expect(towerPriceImpactPercent(1780)).toBeCloseTo(17.8, 5);
    expect(towerPriceImpactPercent(0)).toBe(0);
  });
  it("keeps unknown unknown", () => {
    expect(towerPriceImpactPercent(undefined)).toBeUndefined();
    expect(towerPriceImpactPercent(null)).toBeUndefined();
    expect(towerPriceImpactPercent(-1)).toBeUndefined();
  });
});
