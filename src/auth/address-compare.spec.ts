import { addressesEqual, normalizeAddressForKey } from "./address-compare";

describe("addressesEqual", () => {
  it("EVM: case-insensitive", () => {
    expect(
      addressesEqual(
        "0xABCD0000000000000000000000000000DEADBEEF",
        "0xabcd0000000000000000000000000000deadbeef",
        "eip155",
      ),
    ).toBe(true);
  });

  it("Solana: case-sensitive (rejects lowered base58)", () => {
    const addr = "ABcd1234XyZMixedBase58";
    expect(addressesEqual(addr, addr, "solana")).toBe(true);
    expect(addressesEqual(addr, addr.toLowerCase(), "solana")).toBe(false);
  });

  it("namespace inferred from EVM shape", () => {
    expect(
      addressesEqual(
        "0xABCD0000000000000000000000000000DEADBEEF",
        "0xabcd0000000000000000000000000000deadbeef",
      ),
    ).toBe(true);
  });

  it("namespace inferred as Solana when not EVM-shaped", () => {
    const addr = "Solana7sG9pKmJwTDS";
    expect(addressesEqual(addr, addr.toLowerCase())).toBe(false);
  });

  it("returns false for null/undefined", () => {
    expect(addressesEqual(null, "x")).toBe(false);
    expect(addressesEqual(undefined, "x")).toBe(false);
    expect(addressesEqual("x", null)).toBe(false);
  });
});

describe("normalizeAddressForKey", () => {
  it("lowers EVM", () => {
    expect(
      normalizeAddressForKey("0xABCD0000000000000000000000000000DEADBEEF", "eip155"),
    ).toBe("0xabcd0000000000000000000000000000deadbeef");
  });

  it("preserves Solana case", () => {
    const addr = "ABcdMixedCaseBase58";
    expect(normalizeAddressForKey(addr, "solana")).toBe(addr);
  });
});
