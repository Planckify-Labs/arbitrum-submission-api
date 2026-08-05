/**
 * §10.6 — "make invalid states unconstructible rather than relying on
 * call-site discipline".
 *
 * These are the unit tests the spec names explicitly: assert
 * `mintRecipient == destinationCaller == CctpForwarder` and
 * `decimals == 7`. They are cheap insurance against permanent,
 * unrecoverable loss of funds (§5.4.1).
 */

import {
  assertBurnParamsSafe,
  buildStellarBurnParams,
  CctpParamError,
  encodeStellarForwardHook,
  EVM_USDC_DECIMALS,
  isStellarCctpEnabled,
  sourceUsdcToStellarUnits,
  STELLAR_CCTP_CONTRACTS,
  STELLAR_CCTP_DOMAIN,
  STELLAR_USDC_DECIMALS,
  stellarUnitsToSourceUsdc,
  strkeyToBytes32,
  type StellarBurnParams,
} from "./stellar-burn-params";

// A well-formed Stellar account strkey (the USDC issuer on pubnet), used
// purely as a valid `G…` fixture.
const RECIPIENT_G =
  "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const BURN_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

function build(overrides: Partial<Parameters<typeof buildStellarBurnParams>[0]> = {}) {
  return buildStellarBurnParams({
    network: "testnet",
    amountRaw: 10_000_000n,
    burnToken: BURN_TOKEN,
    recipientStrkey: RECIPIENT_G,
    maxFeeRaw: 1_000n,
    ...overrides,
  });
}

describe("buildStellarBurnParams", () => {
  it("sets mintRecipient == destinationCaller == CctpForwarder", () => {
    const params = build();
    expect(params.mintRecipient).toBe(params.destinationCaller);
    expect(params.forwarderContractId).toBe(
      STELLAR_CCTP_CONTRACTS.testnet.forwarder,
    );
    // And it really is the forwarder's 32 bytes, not just self-consistent.
    const expected = Buffer.from(
      strkeyToBytes32(STELLAR_CCTP_CONTRACTS.testnet.forwarder),
    ).toString("hex");
    expect(params.mintRecipient).toBe(`0x${expected}`);
  });

  it("pins the mainnet forwarder for pubnet", () => {
    const params = build({ network: "pubnet" });
    expect(params.forwarderContractId).toBe(
      STELLAR_CCTP_CONTRACTS.pubnet.forwarder,
    );
    expect(params.mintRecipient).toBe(params.destinationCaller);
  });

  it("always targets the Stellar domain", () => {
    expect(build().destinationDomain).toBe(STELLAR_CCTP_DOMAIN);
    expect(STELLAR_CCTP_DOMAIN).toBe(27);
  });

  it("forces Standard finality because Stellar has no Fast Transfer", () => {
    expect(build().minFinalityThreshold).toBe(2000);
  });

  it("emits hook data carrying the cctp-forward magic bytes", () => {
    const params = build();
    // "cctp-forward" in ASCII hex.
    expect(params.hookData.startsWith("0x636374702d666f7277617264")).toBe(true);
  });

  it("embeds the recipient's 32 bytes in the hook body", () => {
    const params = build();
    const recipientHex = Buffer.from(strkeyToBytes32(RECIPIENT_G)).toString(
      "hex",
    );
    expect(params.hookData.endsWith(recipientHex)).toBe(true);
    // Header is 32 bytes = 64 hex chars, after the `0x`.
    expect(params.hookData.slice(2, 66)).toHaveLength(64);
  });

  it("rejects a muxed address rather than truncating it", () => {
    expect(() =>
      build({
        recipientStrkey:
          "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVAAAAAAAAAAAAAJLK",
      }),
    ).toThrow(CctpParamError);
  });

  it("rejects a malformed strkey", () => {
    expect(() => build({ recipientStrkey: "not-a-strkey" })).toThrow(
      CctpParamError,
    );
  });

  it("rejects a non-positive amount", () => {
    expect(() => build({ amountRaw: 0n })).toThrow(CctpParamError);
  });

  it("rejects a max fee that swallows the whole transfer", () => {
    expect(() => build({ amountRaw: 100n, maxFeeRaw: 100n })).toThrow(
      CctpParamError,
    );
  });

  it("rejects a burn token that is not an EVM address", () => {
    expect(() =>
      build({ burnToken: "0xnope" as `0x${string}` }),
    ).toThrow(CctpParamError);
  });

  it("returns a frozen object so params cannot be mutated after validation", () => {
    const params = build();
    expect(Object.isFrozen(params)).toBe(true);
  });
});

describe("assertBurnParamsSafe", () => {
  it("catches a hand-built mismatch between mintRecipient and destinationCaller", () => {
    const good = build();
    const tampered: StellarBurnParams = {
      ...good,
      destinationCaller: `0x${"11".repeat(32)}`,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      /mint_recipient_must_equal_destination_caller/,
    );
  });

  it("catches a recipient smuggled into mintRecipient instead of the forwarder", () => {
    const good = build();
    const recipientBytes = Buffer.from(strkeyToBytes32(RECIPIENT_G)).toString(
      "hex",
    );
    const tampered: StellarBurnParams = {
      ...good,
      mintRecipient: `0x${recipientBytes}`,
      destinationCaller: `0x${recipientBytes}`,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      /mint_recipient_must_be_cctp_forwarder/,
    );
  });

  it("catches a wrong destination domain", () => {
    const tampered: StellarBurnParams = {
      ...build(),
      destinationDomain: 6,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      /destination_domain_must_be_stellar/,
    );
  });

  it("catches hook data missing the reserved magic bytes", () => {
    const tampered: StellarBurnParams = {
      ...build(),
      hookData: "0xdeadbeef",
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      /hook_data_missing_cctp_forward_magic/,
    );
  });
});

describe("decimals asymmetry", () => {
  it("knows Stellar USDC is 7 decimals and every other CCTP chain is 6", () => {
    expect(STELLAR_USDC_DECIMALS).toBe(7);
    expect(EVM_USDC_DECIMALS).toBe(6);
  });

  it("scales a 6-decimal source amount to Stellar's 7-decimal units", () => {
    // 10 USDC on Base = 10_000_000 (6dp) → 100_000_000 (7dp) on Stellar.
    expect(sourceUsdcToStellarUnits(10_000_000n)).toBe(100_000_000n);
  });

  it("round-trips without drift", () => {
    const source = 123_456_789n;
    expect(stellarUnitsToSourceUsdc(sourceUsdcToStellarUnits(source))).toBe(
      source,
    );
  });

  it("would be off by 10x if a shared 6-decimal constant were used", () => {
    // The exact bug §6 warns about, pinned so nobody "simplifies" it away.
    const naive = 10_000_000n;
    expect(sourceUsdcToStellarUnits(naive)).toBe(naive * 10n);
  });
});

describe("encodeStellarForwardHook", () => {
  it("lays out magic(24) + version(4) + length(4) + body", () => {
    const hook = encodeStellarForwardHook(RECIPIENT_G);
    const bytes = Buffer.from(hook.slice(2), "hex");
    expect(bytes.subarray(0, 12).toString("ascii")).toBe("cctp-forward");
    expect(bytes.subarray(12, 24).every((b) => b === 0)).toBe(true);
    expect(bytes.readUInt32BE(24)).toBe(0);
    expect(bytes.readUInt32BE(28)).toBe(32);
    expect(bytes.length).toBe(64);
  });
});

describe("isStellarCctpEnabled", () => {
  it("allows testnet so the mandatory dry-run can happen", () => {
    expect(isStellarCctpEnabled("testnet", {})).toBe(true);
  });

  it("blocks mainnet by default until the dry-run is signed off", () => {
    expect(isStellarCctpEnabled("pubnet", {})).toBe(false);
  });

  it("opens mainnet only on an explicit opt-in", () => {
    expect(
      isStellarCctpEnabled("pubnet", { CCTP_STELLAR_MAINNET_ENABLED: "true" }),
    ).toBe(true);
    expect(
      isStellarCctpEnabled("pubnet", { CCTP_STELLAR_MAINNET_ENABLED: "1" }),
    ).toBe(false);
  });
});
