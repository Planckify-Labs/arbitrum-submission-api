/**
 * §10.6 — "make invalid states unconstructible rather than relying on
 * call-site discipline".
 *
 * The unit tests the spec names explicitly (`mintRecipient ==
 * destinationCaller == CctpForwarder`, `decimals == 7`), plus a GOLDEN
 * VECTOR taken byte-for-byte from a successful mainnet Base → Stellar
 * transfer, so the hook layout is pinned to what Circle's forwarder
 * actually accepted on-chain rather than to anyone's reading of a doc.
 */

import { StrKey, scValToNative, xdr } from "@stellar/stellar-base";
import {
  CctpParamError,
  EVM_USDC_DECIMALS,
  FORWARDING_SERVICE_HOOK_V0,
  STELLAR_CCTP_CONTRACTS,
  STELLAR_CCTP_DOMAIN,
  STELLAR_USDC_DECIMALS,
  type StellarBurnParams,
  assertBurnParamsSafe,
  buildMintAndForwardInvocation,
  buildStellarBurnParams,
  buildStellarSourceBurn,
  decodeStellarForwardHook,
  encodeStellarForwardHook,
  isStellarCctpEnabled,
  sourceUsdcToStellarUnits,
  stellarUnitsToSourceUsdc,
  stellarUsdcSacId,
} from "./stellar-burn-params";

/**
 * Mainnet tx b2424716d55b975c9412ff07935e44a813d4927e70ee0090c3df2e74b3f13f53
 * (ledger 64616672, `mint_and_forward`, SUCCESS), a Base (domain 6) →
 * Stellar (domain 27) transfer. Its burn message carried exactly these
 * bytes; the CctpForwarder minted and paid out against them.
 */
const GOLDEN = {
  recipient: "GAMNA2Q6NTZSUBLMEXLTIXYORE7OXJJBMEGIX7T2OXDAKIA7CCKN4RJV",
  hook: "0x000000000000000000000000000000000000000000000000000000000000003847414d4e413251364e545a5355424c4d45584c544958594f5245374f584a4a424d454749583754324f5844414b49413743434b4e34524a56",
  // mintRecipient and destinationCaller in that message: the pubnet forwarder.
  forwarderBytes32:
    "0x72bd20ff2f8281801bb05b7c29179026933256fabafeb13e94efd8ddbcfcf291",
};

// A well-formed Stellar account strkey (the USDC issuer on pubnet), used
// purely as a valid `G…` fixture.
const RECIPIENT_G = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";

const BURN_TOKEN = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;

function build(
  overrides: Partial<Parameters<typeof buildStellarBurnParams>[0]> = {},
) {
  return buildStellarBurnParams({
    network: "testnet",
    amountRaw: 10_000_000n,
    burnToken: BURN_TOKEN,
    recipientStrkey: RECIPIENT_G,
    maxFeeRaw: 1_000n,
    ...overrides,
  });
}

function forwarderHex(network: "pubnet" | "testnet"): string {
  return `0x${Buffer.from(StrKey.decodeContract(STELLAR_CCTP_CONTRACTS[network].forwarder)).toString("hex")}`;
}

describe("golden vector (mainnet Base → Stellar)", () => {
  it("encodes the hook byte-for-byte as the forwarder accepted it on mainnet", () => {
    expect(encodeStellarForwardHook(GOLDEN.recipient)).toBe(GOLDEN.hook);
  });

  it("derives mintRecipient and destinationCaller exactly as on mainnet", () => {
    const params = buildStellarBurnParams({
      network: "pubnet",
      amountRaw: 1_000_000n,
      burnToken: BURN_TOKEN,
      recipientStrkey: GOLDEN.recipient,
      maxFeeRaw: 0n,
    });
    expect(params.mintRecipient).toBe(GOLDEN.forwarderBytes32);
    expect(params.destinationCaller).toBe(GOLDEN.forwarderBytes32);
    expect(params.hookData).toBe(GOLDEN.hook);
  });

  it("round-trips the golden hook back to its recipient", () => {
    expect(decodeStellarForwardHook(GOLDEN.hook)).toBe(GOLDEN.recipient);
  });
});

describe("encodeStellarForwardHook", () => {
  it("lays out zero magic(24) + version 0 + length + UTF-8 strkey", () => {
    const bytes = Buffer.from(
      encodeStellarForwardHook(RECIPIENT_G).slice(2),
      "hex",
    );
    expect(bytes.subarray(0, 24).every((b) => b === 0)).toBe(true);
    expect(bytes.readUInt32BE(24)).toBe(0);
    expect(bytes.readUInt32BE(28)).toBe(56);
    expect(bytes.subarray(32).toString("utf8")).toBe(RECIPIENT_G);
    expect(bytes.length).toBe(32 + 56);
  });

  it("never writes the Forwarding Service magic: Stellar has no Forwarding Service", () => {
    const hook = encodeStellarForwardHook(RECIPIENT_G);
    expect(hook.startsWith("0x636374702d666f7277617264")).toBe(false);
  });

  it("accepts a contract (C…) recipient", () => {
    const c = STELLAR_CCTP_CONTRACTS.testnet.forwarder;
    expect(decodeStellarForwardHook(encodeStellarForwardHook(c))).toBe(c);
  });

  it("rejects a muxed address rather than forwarding it unchecked", () => {
    expect(() =>
      encodeStellarForwardHook(
        "MA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJUAAAAAAAAAAAACJUQ",
      ),
    ).toThrow("muxed_address_unsupported");
  });

  it("rejects a malformed strkey", () => {
    expect(() => encodeStellarForwardHook("not-a-strkey")).toThrow(
      "invalid_stellar_strkey",
    );
  });
});

describe("decodeStellarForwardHook", () => {
  it("rejects a hook carrying the cctp-forward magic", () => {
    const good = Buffer.from(
      encodeStellarForwardHook(RECIPIENT_G).slice(2),
      "hex",
    );
    good.write("cctp-forward", 0, "ascii");
    expect(() => decodeStellarForwardHook(`0x${good.toString("hex")}`)).toThrow(
      "hook_magic_must_be_zero",
    );
  });

  it("rejects a length field that does not match the body", () => {
    const good = Buffer.from(
      encodeStellarForwardHook(RECIPIENT_G).slice(2),
      "hex",
    );
    good.writeUInt32BE(32, 28);
    expect(() => decodeStellarForwardHook(`0x${good.toString("hex")}`)).toThrow(
      "hook_length_mismatch",
    );
  });
});

describe("buildStellarBurnParams (EVM → Stellar)", () => {
  it("sets mintRecipient == destinationCaller == CctpForwarder", () => {
    const params = build();
    expect(params.mintRecipient).toBe(params.destinationCaller);
    expect(params.forwarderContractId).toBe(
      STELLAR_CCTP_CONTRACTS.testnet.forwarder,
    );
    expect(params.mintRecipient).toBe(forwarderHex("testnet"));
  });

  it("pins the mainnet forwarder for pubnet", () => {
    const params = build({ network: "pubnet" });
    expect(params.forwarderContractId).toBe(
      STELLAR_CCTP_CONTRACTS.pubnet.forwarder,
    );
    expect(params.mintRecipient).toBe(forwarderHex("pubnet"));
  });

  it("always targets the Stellar domain", () => {
    expect(build().destinationDomain).toBe(STELLAR_CCTP_DOMAIN);
    expect(STELLAR_CCTP_DOMAIN).toBe(27);
  });

  it("forces Standard finality", () => {
    expect(build().minFinalityThreshold).toBe(2000);
  });

  it("carries the requested recipient in the hook", () => {
    expect(decodeStellarForwardHook(build().hookData)).toBe(RECIPIENT_G);
  });

  it("rejects a non-positive amount", () => {
    expect(() => build({ amountRaw: 0n })).toThrow(CctpParamError);
  });

  it("rejects a max fee that swallows the whole transfer", () => {
    expect(() => build({ amountRaw: 100n, maxFeeRaw: 100n })).toThrow(
      "max_fee_out_of_range",
    );
  });

  it("rejects a burn token that is not an EVM address", () => {
    expect(() => build({ burnToken: "0x1234" as `0x${string}` })).toThrow(
      "invalid_burn_token",
    );
  });

  it("returns a frozen object so params cannot be mutated after validation", () => {
    expect(Object.isFrozen(build())).toBe(true);
  });
});

describe("assertBurnParamsSafe", () => {
  it("catches a hand-built mismatch between mintRecipient and destinationCaller", () => {
    const tampered: StellarBurnParams = {
      ...build(),
      destinationCaller: `0x${"00".repeat(32)}`,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      "mint_recipient_must_equal_destination_caller",
    );
  });

  it("catches a recipient smuggled into mintRecipient instead of the forwarder", () => {
    const recipientBytes =
      `0x${Buffer.from(StrKey.decodeEd25519PublicKey(RECIPIENT_G)).toString("hex")}` as const;
    const tampered: StellarBurnParams = {
      ...build(),
      mintRecipient: recipientBytes,
      destinationCaller: recipientBytes,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      "mint_recipient_must_be_cctp_forwarder",
    );
  });

  it("catches a wrong destination domain", () => {
    const tampered: StellarBurnParams = { ...build(), destinationDomain: 6 };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      "destination_domain_must_be_stellar",
    );
  });

  it("catches a hook that names a different recipient than the params claim", () => {
    const other = STELLAR_CCTP_CONTRACTS.testnet.forwarder;
    const tampered: StellarBurnParams = {
      ...build(),
      hookData: encodeStellarForwardHook(other),
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      "hook_recipient_mismatch",
    );
  });

  it("catches the pre-2026-09-26 Forwarding-Service-magic hook", () => {
    const bad = Buffer.from(build().hookData.slice(2), "hex");
    bad.write("cctp-forward", 0, "ascii");
    const tampered: StellarBurnParams = {
      ...build(),
      hookData: `0x${bad.toString("hex")}`,
    };
    expect(() => assertBurnParamsSafe(tampered)).toThrow(
      "hook_magic_must_be_zero",
    );
  });
});

describe("buildMintAndForwardInvocation (the Stellar claim)", () => {
  it("targets the PINNED forwarder with mint_and_forward(message, attestation)", () => {
    const inv = buildMintAndForwardInvocation({
      network: "pubnet",
      messageHex: "0x0102",
      attestationHex: "0xaabbcc",
    });
    expect(inv.contractId).toBe(STELLAR_CCTP_CONTRACTS.pubnet.forwarder);
    expect(inv.method).toBe("mint_and_forward");
    const [message, attestation] = inv.argsXdrBase64.map((a) =>
      Buffer.from(scValToNative(xdr.ScVal.fromXDR(a, "base64"))).toString(
        "hex",
      ),
    );
    expect(message).toBe("0102");
    expect(attestation).toBe("aabbcc");
  });

  it("refuses empty message or attestation bytes", () => {
    expect(() =>
      buildMintAndForwardInvocation({
        network: "testnet",
        messageHex: "0x",
        attestationHex: "0x01",
      }),
    ).toThrow("empty_message_or_attestation");
  });
});

describe("buildStellarSourceBurn (Stellar → EVM)", () => {
  const base = {
    network: "testnet" as const,
    callerStrkey: RECIPIENT_G,
    amountRaw: 12_345_678n, // 1.2345678 USDC, seven decimals
    destinationDomain: 6,
    mintRecipientEvm: "0x3304E22DDaa22bCdC5fCa2269b418046aE7b566A",
    maxFeeRaw6: 54_577n,
  };

  function decodedArgs(burn: ReturnType<typeof buildStellarSourceBurn>) {
    return burn.argsXdrBase64.map((a) => xdr.ScVal.fromXDR(a, "base64"));
  }

  it("targets the pinned TokenMessengerMinter's deposit_for_burn_with_hook", () => {
    const burn = buildStellarSourceBurn(base);
    expect(burn.contractId).toBe(
      STELLAR_CCTP_CONTRACTS.testnet.tokenMessengerMinter,
    );
    expect(burn.method).toBe("deposit_for_burn_with_hook");
    expect(burn.argsXdrBase64).toHaveLength(9);
  });

  it("burns only through the sixth decimal, as Circle documents", () => {
    const burn = buildStellarSourceBurn(base);
    expect(burn.burnedRaw7).toBe(12_345_670n);
    expect(burn.messageAmountRaw6).toBe(1_234_567n);
    expect(scValToNative(decodedArgs(burn)[1])).toBe(12_345_670n);
  });

  it("encodes args in the deployed contract's positional order", () => {
    const args = decodedArgs(buildStellarSourceBurn(base));
    expect(scValToNative(args[0])).toBe(RECIPIENT_G); // caller
    expect(scValToNative(args[2])).toBe(6); // destination_domain
    expect(Buffer.from(scValToNative(args[3])).toString("hex")).toBe(
      `000000000000000000000000${base.mintRecipientEvm.slice(2).toLowerCase()}`,
    ); // mint_recipient
    expect(scValToNative(args[4])).toBe(stellarUsdcSacId("testnet")); // burn_token
    expect(
      Buffer.from(scValToNative(args[5])).every((b: number) => b === 0),
    ).toBe(true); // destination_caller
    expect(scValToNative(args[6])).toBe(545_770n); // max_fee, seven-decimal units
    expect(scValToNative(args[7])).toBe(2000); // min_finality_threshold
    expect(`0x${Buffer.from(scValToNative(args[8])).toString("hex")}`).toBe(
      FORWARDING_SERVICE_HOOK_V0,
    ); // hook_data
  });

  it("approves exactly the burned amount to the TokenMessengerMinter, on the USDC SAC", () => {
    // The contract pulls with `transfer_from`: a testnet simulation
    // without this allowance fails "not enough allowance to spend".
    const burn = buildStellarSourceBurn(base);
    expect(burn.approval).toEqual({
      token: stellarUsdcSacId("testnet"),
      spender: STELLAR_CCTP_CONTRACTS.testnet.tokenMessengerMinter,
      amountRaw: burn.burnedRaw7,
    });
  });

  it("derives the pubnet USDC SAC from the pinned classic asset", () => {
    expect(stellarUsdcSacId("pubnet")).toBe(
      "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
    );
  });

  it("refuses a Stellar destination, a non-EVM recipient, and a contract caller", () => {
    expect(() =>
      buildStellarSourceBurn({ ...base, destinationDomain: 27 }),
    ).toThrow("destination_must_not_be_stellar");
    expect(() =>
      buildStellarSourceBurn({ ...base, mintRecipientEvm: RECIPIENT_G }),
    ).toThrow("mint_recipient_must_be_evm_address");
    expect(() =>
      buildStellarSourceBurn({
        ...base,
        callerStrkey: STELLAR_CCTP_CONTRACTS.testnet.forwarder,
      }),
    ).toThrow("caller_must_be_account");
  });

  it("refuses an amount the forwarding fee would swallow", () => {
    expect(() =>
      buildStellarSourceBurn({ ...base, amountRaw: 500_000n }),
    ).toThrow("amount_does_not_cover_fee");
  });
});

describe("decimals asymmetry", () => {
  it("knows Stellar USDC is 7 decimals and every other CCTP chain is 6", () => {
    expect(STELLAR_USDC_DECIMALS).toBe(7);
    expect(EVM_USDC_DECIMALS).toBe(6);
  });

  it("scales a 6-decimal source amount to Stellar's 7-decimal units", () => {
    expect(sourceUsdcToStellarUnits(10_000_000n)).toBe(100_000_000n);
  });

  it("round-trips without drift", () => {
    const source = 123_456_789n;
    expect(stellarUnitsToSourceUsdc(sourceUsdcToStellarUnits(source))).toBe(
      source,
    );
  });
});

describe("isStellarCctpEnabled", () => {
  it("allows testnet so the mandatory dry-run can happen", () => {
    expect(isStellarCctpEnabled("testnet", {})).toBe(true);
  });

  it("blocks mainnet by default until the dry-run is signed off", () => {
    expect(isStellarCctpEnabled("pubnet", {})).toBe(false);
  });

  it("opens mainnet only on the explicit flag", () => {
    expect(
      isStellarCctpEnabled("pubnet", { CCTP_STELLAR_MAINNET_ENABLED: "true" }),
    ).toBe(true);
    expect(
      isStellarCctpEnabled("pubnet", { CCTP_STELLAR_MAINNET_ENABLED: "1" }),
    ).toBe(false);
  });
});
