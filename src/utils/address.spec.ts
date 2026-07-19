import { getAddress } from "viem";
import { canonicalizeWalletAddress, truncateAddress } from "./address";

// A real EVM address (from the User table) in checksummed + lowercased forms.
const EVM_CHECKSUM = "0x877862C2B7DEfD1beeD83f4654b040f70809c9Dc";
const EVM_LOWER = EVM_CHECKSUM.toLowerCase();
// base58, case-significant.
const SOLANA = "7EqQdEULxWcraVx3mXKFjc84LhCkMGZCkRuDpvcMwJeK";
// base32 StrKey, all-uppercase, case-significant.
const STELLAR = "GAKONCKYJ7PRRKBZSWVPG3MURUNX7FDMTKM6H2DXNTNBFHFZC2LFK6RS";
// Sui: 0x + 64 hex, case-insignificant.
const SUI_UPPER =
  "0xAABBCCDDEEFF00112233445566778899AABBCCDDEEFF00112233445566778899";

describe("canonicalizeWalletAddress", () => {
  describe("EVM (eip155)", () => {
    it("collapses case to the EIP-55 checksum, whatever the input casing", () => {
      const expected = getAddress(EVM_LOWER);
      expect(canonicalizeWalletAddress(EVM_LOWER, "eip155")).toBe(expected);
      expect(canonicalizeWalletAddress(EVM_CHECKSUM, "eip155")).toBe(expected);
      // Same wallet, two casings -> one canonical string (the dedup guarantee).
      expect(canonicalizeWalletAddress(EVM_LOWER, "eip155")).toBe(
        canonicalizeWalletAddress(EVM_CHECKSUM, "eip155"),
      );
    });

    it("is idempotent", () => {
      const once = canonicalizeWalletAddress(EVM_LOWER, "eip155");
      expect(canonicalizeWalletAddress(once, "eip155")).toBe(once);
    });
  });

  describe("case-significant chains keep their exact bytes", () => {
    it("returns Solana base58 verbatim (never lowercased)", () => {
      expect(canonicalizeWalletAddress(SOLANA, "solana")).toBe(SOLANA);
      expect(canonicalizeWalletAddress(SOLANA, "solana")).not.toBe(
        SOLANA.toLowerCase(),
      );
    });

    it("returns Stellar base32 verbatim (never lowercased)", () => {
      expect(canonicalizeWalletAddress(STELLAR, "stellar")).toBe(STELLAR);
      expect(canonicalizeWalletAddress(STELLAR, "stellar")).not.toBe(
        STELLAR.toLowerCase(),
      );
    });
  });

  describe("Sui (hex, case-insignificant)", () => {
    it("lowercases", () => {
      expect(canonicalizeWalletAddress(SUI_UPPER, "sui")).toBe(
        SUI_UPPER.toLowerCase(),
      );
    });
  });

  describe("namespace inference (no namespace passed — the push path)", () => {
    it("checksums a 20-byte 0x-hex address as EVM", () => {
      expect(canonicalizeWalletAddress(EVM_LOWER)).toBe(getAddress(EVM_LOWER));
    });

    it("lowercases a 32-byte 0x-hex address as Sui", () => {
      expect(canonicalizeWalletAddress(SUI_UPPER)).toBe(SUI_UPPER.toLowerCase());
    });

    it("leaves base58 / base32 verbatim", () => {
      expect(canonicalizeWalletAddress(SOLANA)).toBe(SOLANA);
      expect(canonicalizeWalletAddress(STELLAR)).toBe(STELLAR);
    });
  });

  it("folds a malformed hex string deterministically instead of throwing", () => {
    const bad = "0xZZZ";
    expect(() => canonicalizeWalletAddress(bad, "eip155")).not.toThrow();
    expect(canonicalizeWalletAddress(bad, "eip155")).toBe("0xzzz");
  });
});

describe("truncateAddress", () => {
  it("keeps first 8 + last 8", () => {
    expect(truncateAddress(EVM_CHECKSUM)).toBe("0x877862...0809c9Dc");
  });
});
