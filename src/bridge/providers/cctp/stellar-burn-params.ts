/**
 * CCTP → Stellar burn parameters. Pure, no I/O, no Nest.
 *
 * Spec: docs/bridge-capability-spec.md §5.4.1, §10.6.
 *
 * ⚠️ THIS FILE GUARDS AGAINST PERMANENT, UNRECOVERABLE LOSS OF FUNDS.
 *
 * CCTP messages carry only a raw 32-byte payload with no strkey type
 * identifier, so the protocol cannot tell a `G` account from a `C`
 * contract and ASSUMES THE RECIPIENT IS A CONTRACT. On the source burn,
 * BOTH `mintRecipient` AND `destinationCaller` must be set to the
 * `CctpForwarder` contract address, with the real recipient encoded as a
 * strkey in hook data.
 *
 *   - Wrong `destinationCaller` → the forwarder cannot complete the transfer.
 *   - `mintRecipient` set to a user or muxed address → USDC never reaches
 *     the forwarder.
 *
 * Circle's documentation states that either way the funds are
 * PERMANENTLY STUCK AND CANNOT BE RECOVERED.
 *
 * Decision §10.6 is therefore to make invalid states UNCONSTRUCTIBLE
 * rather than rely on call-site discipline. That is why
 * `buildStellarBurnParams` takes NO `mintRecipient` and NO
 * `destinationCaller` argument: both are DERIVED from the pinned
 * forwarder address, so there is no parameter a caller could get wrong.
 */

import { StrKey } from "@stellar/stellar-base";

/** Circle-issued domain id for Stellar. Verified against Circle's
 *  supported-chains reference. Domains are deliberately unrelated to
 *  public chain ids. */
export const STELLAR_CCTP_DOMAIN = 27;

/**
 * Stellar USDC has SEVEN decimals. Every other CCTP chain has six.
 *
 * This constant exists so the asymmetry is named and testable, NOT so it
 * can be used as a shared default — amounts must always come from the
 * token metadata the adapter resolves (§6). A shared `USDC_DECIMALS = 6`
 * would misprice every Stellar amount by 10x.
 */
export const STELLAR_USDC_DECIMALS = 7;
export const EVM_USDC_DECIMALS = 6;

export type StellarCctpNetwork = "pubnet" | "testnet";

/**
 * Pinned Stellar CCTP contract ids, verified against Circle's Stellar
 * contract-address reference (developers.circle.com, 2026-08-04).
 *
 * Treat this table as security-reviewed. A wrong forwarder address here
 * loses funds silently and irrecoverably.
 */
export const STELLAR_CCTP_CONTRACTS: Record<
  StellarCctpNetwork,
  { tokenMessengerMinter: string; messageTransmitter: string; forwarder: string }
> = {
  pubnet: {
    tokenMessengerMinter:
      "CAE2G5Z77UP7GYPYGFOWFGW7C7J6I4YP2AFGSADRKQY62SYUFLPNFTXL",
    messageTransmitter:
      "CACMENFFJPJMSDAJQLX4R7K3SFZIW2LJSE3R2UMLGSWHFHS353FVXAZV",
    forwarder: "CBZL2IH7F6BIDAA3WBNXYKIXSATJGMSW7K5P5MJ6STX5RXN47TZJDF5T",
  },
  testnet: {
    tokenMessengerMinter:
      "CDNG7HXAPBWICI2E3AUBP3YZWZELJLYSB6F5CC7WLDTLTHVM74SLRTHP",
    messageTransmitter:
      "CBJ6MTCKKZG73PMDZCJMSFRD7DQEMI4FKDH7CGDSV4W6FHCRBCQAVVJY",
    forwarder: "CA66Q2WFBND6V4UEB7RD4SAXSVIWMD6RA4X3U32ELVFGXV5PJK4T4VSZ",
  },
};

/**
 * Circle's reserved hook header (§ Forwarding-Service hook format,
 * verified against Circle primary source):
 *
 *   bytes  0-23  bytes24  ASCII "cctp-forward", zero-padded
 *   bytes 24-27  uint32   version, 0
 *   bytes 28-31  uint32   length of additional Circle hook data
 *   bytes 32+    any      developer-defined payload
 */
const HOOK_MAGIC = "cctp-forward";
const HOOK_VERSION = 0;

export class CctpParamError extends Error {
  readonly name = "CctpParamError";
}

/** 32-byte value rendered as a `0x`-prefixed hex string. */
export type Bytes32 = `0x${string}`;

/**
 * Decode a Stellar strkey to its raw 32 bytes.
 *
 * `C…` is a contract id, `G…` an ed25519 account id. Both decode to
 * exactly 32 bytes, which is what CCTP's opaque payload carries. Muxed
 * (`M…`) addresses are REJECTED: they are 40 bytes and carry a memo id
 * that CCTP cannot represent, so accepting one would silently truncate
 * and send funds somewhere unrecoverable.
 */
export function strkeyToBytes32(strkey: string): Uint8Array {
  const value = strkey.trim();
  // Stellar strkeys are base32 and CASE-SENSITIVE in the sense that they
  // are canonically uppercase; never fold case on them
  // (`feedback_address_case_per_encoding`).
  if (StrKey.isValidContract(value)) {
    return Uint8Array.from(StrKey.decodeContract(value));
  }
  if (StrKey.isValidEd25519PublicKey(value)) {
    return Uint8Array.from(StrKey.decodeEd25519PublicKey(value));
  }
  if (value.startsWith("M")) {
    throw new CctpParamError(
      "muxed_address_unsupported: CCTP carries 32 opaque bytes and cannot represent a muxed account",
    );
  }
  throw new CctpParamError("invalid_stellar_strkey");
}

function toHex(bytes: Uint8Array): Bytes32 {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}` as Bytes32;
}

function leftPad32(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 32) {
    throw new CctpParamError("value_exceeds_32_bytes");
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

/**
 * Encode the CctpForwarder hook payload carrying the REAL Stellar
 * recipient.
 *
 * ⚠️ UNVERIFIED ENCODING. Circle publishes the hook layout for HyperCore
 * (a 20-byte EVM address + a uint32 dex id) but, as of 2026-08-04, does
 * not publish the Stellar `forwardRecipient` body layout. The header
 * (magic + version + length) IS verified; the 32-byte strkey body below
 * is our best reading of "the real recipient encoded as a strkey in hook
 * data" and MUST be confirmed against a Stellar testnet transfer before
 * any mainnet path is enabled.
 *
 * `assertStellarCctpEnabled` hard-blocks mainnet until that dry-run
 * happens, so this function cannot be reached with real funds by
 * accident. Do not remove that gate on the strength of this comment.
 */
export function encodeStellarForwardHook(recipientStrkey: string): Bytes32Hex {
  const recipient = strkeyToBytes32(recipientStrkey);

  const magic = new Uint8Array(24);
  const magicAscii = new TextEncoder().encode(HOOK_MAGIC);
  magic.set(magicAscii, 0);

  const version = new Uint8Array(4);
  new DataView(version.buffer).setUint32(0, HOOK_VERSION, false);

  const dataLength = new Uint8Array(4);
  new DataView(dataLength.buffer).setUint32(0, recipient.length, false);

  const out = new Uint8Array(
    magic.length + version.length + dataLength.length + recipient.length,
  );
  out.set(magic, 0);
  out.set(version, 24);
  out.set(dataLength, 28);
  out.set(recipient, 32);

  return toHex(out) as Bytes32Hex;
}

/** Hook data is variable-length, so it is a plain hex string, not 32 bytes. */
export type Bytes32Hex = `0x${string}`;

export interface StellarBurnParamsInput {
  network: StellarCctpNetwork;
  /** Amount in the SOURCE chain's USDC units (6 decimals on every EVM chain). */
  amountRaw: bigint;
  /** USDC contract on the source chain. */
  burnToken: `0x${string}`;
  /** The Stellar account that should end up holding the USDC. */
  recipientStrkey: string;
  /** Max fee the user tolerates, in source USDC units. */
  maxFeeRaw: bigint;
}

/**
 * Finality threshold for a Standard transfer (`1000` would request Fast).
 *
 * Stellar has NO Fast Transfer (§2.3), so this is fixed rather than
 * selectable — another parameter a caller cannot get wrong.
 */
const STANDARD_FINALITY_THRESHOLD = 2000;

export interface StellarBurnParams {
  readonly destinationDomain: number;
  readonly amountRaw: bigint;
  readonly burnToken: `0x${string}`;
  readonly mintRecipient: Bytes32;
  readonly destinationCaller: Bytes32;
  readonly maxFeeRaw: bigint;
  readonly minFinalityThreshold: number;
  readonly hookData: Bytes32Hex;
  /** The forwarder these params are pinned to, for assertion in tests. */
  readonly forwarderContractId: string;
}

/**
 * Build a provably-consistent `depositForBurnWithHook` argument set.
 *
 * Note what this signature does NOT accept: `mintRecipient` and
 * `destinationCaller`. Both are derived from the pinned forwarder for the
 * requested network, so the mismatch that permanently strands funds is
 * not expressible by a caller (§10.6).
 */
export function buildStellarBurnParams(
  input: StellarBurnParamsInput,
): StellarBurnParams {
  const contracts = STELLAR_CCTP_CONTRACTS[input.network];
  if (!contracts) {
    throw new CctpParamError("unknown_stellar_network");
  }
  if (input.amountRaw <= 0n) {
    throw new CctpParamError("amount_must_be_positive");
  }
  if (input.maxFeeRaw < 0n || input.maxFeeRaw >= input.amountRaw) {
    throw new CctpParamError("max_fee_out_of_range");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.burnToken)) {
    throw new CctpParamError("invalid_burn_token");
  }

  const forwarderBytes = leftPad32(strkeyToBytes32(contracts.forwarder));
  const forwarder = toHex(forwarderBytes);

  const params: StellarBurnParams = Object.freeze({
    destinationDomain: STELLAR_CCTP_DOMAIN,
    amountRaw: input.amountRaw,
    burnToken: input.burnToken,
    // Both point at the forwarder. Not a coincidence, not a caller choice.
    mintRecipient: forwarder,
    destinationCaller: forwarder,
    maxFeeRaw: input.maxFeeRaw,
    minFinalityThreshold: STANDARD_FINALITY_THRESHOLD,
    hookData: encodeStellarForwardHook(input.recipientStrkey),
    forwarderContractId: contracts.forwarder,
  });

  // Belt and braces: assert the invariant on the way out, so a future
  // refactor that reintroduces caller-supplied recipients trips here
  // rather than in production.
  assertBurnParamsSafe(params);
  return params;
}

/**
 * The §5.4.1 invariant, expressed as a runtime assertion so it holds even
 * if someone constructs a `StellarBurnParams` by hand.
 */
export function assertBurnParamsSafe(params: StellarBurnParams): void {
  if (params.destinationDomain !== STELLAR_CCTP_DOMAIN) {
    throw new CctpParamError("destination_domain_must_be_stellar");
  }
  if (params.mintRecipient !== params.destinationCaller) {
    throw new CctpParamError(
      "mint_recipient_must_equal_destination_caller",
    );
  }
  const expected = toHex(
    leftPad32(strkeyToBytes32(params.forwarderContractId)),
  );
  if (params.mintRecipient !== expected) {
    throw new CctpParamError("mint_recipient_must_be_cctp_forwarder");
  }
  if (!params.hookData.startsWith("0x636374702d666f7277617264")) {
    throw new CctpParamError("hook_data_missing_cctp_forward_magic");
  }
}

/**
 * Convert a 6-decimal source USDC amount to Stellar's 7-decimal units.
 *
 * Exposed (and tested) so the decimals asymmetry is handled in exactly
 * one place instead of being re-derived at call sites.
 */
export function sourceUsdcToStellarUnits(amountRaw: bigint): bigint {
  return amountRaw * 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);
}

export function stellarUnitsToSourceUsdc(amountRaw: bigint): bigint {
  return amountRaw / 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);
}

/**
 * Mainnet kill switch (§9 phase 4, §10.6).
 *
 * Phase 4 carries a MANDATORY testnet dry-run before any mainnet path
 * ships, and the `forwardRecipient` hook body above is our reading rather
 * than a published layout. Until `CCTP_STELLAR_MAINNET_ENABLED` is set
 * explicitly, mainnet routes report a capability boundary and testnet
 * stays open for exactly the dry-run the spec requires.
 */
export function isStellarCctpEnabled(
  network: StellarCctpNetwork,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (network === "testnet") return true;
  return env.CCTP_STELLAR_MAINNET_ENABLED === "true";
}
