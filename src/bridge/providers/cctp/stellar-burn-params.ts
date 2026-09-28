/**
 * CCTP ⇄ Stellar invocation parameters. Pure, no I/O, no Nest.
 *
 * Spec: docs/bridge-capability-spec.md §5.4.1, §10.6.
 *
 * ⚠️ THIS FILE GUARDS AGAINST PERMANENT, UNRECOVERABLE LOSS OF FUNDS.
 *
 * Three invocations live here, each built so a wrong combination is not
 * expressible by a caller (§10.6):
 *
 *   1. EVM → Stellar burn (`depositForBurnWithHook` on an EVM chain).
 *   2. The Stellar-side claim that completes (1):
 *      `CctpForwarder.mint_and_forward(message, attestation)`.
 *   3. Stellar → EVM burn (`deposit_for_burn_with_hook` on Soroban).
 *
 * ## Sources (verified 2026-09-26)
 *
 * - Circle, "CCTP on Stellar" (`/cctp/references/stellar`): the
 *   `CctpForwarder` rule, the hook layout, and the 7-vs-6 decimals rule.
 * - Circle, "CCTP Stellar contracts and interfaces": contract ids.
 * - The deployed contracts' own embedded Soroban spec (testnet AND
 *   mainnet, identical): `deposit_for_burn_with_hook(caller: Address,
 *   amount: i128, destination_domain: u32, mint_recipient: BytesN<32>,
 *   burn_token: Address, destination_caller: BytesN<32>, max_fee: i128,
 *   min_finality_threshold: u32, hook_data: Bytes)` and
 *   `mint_and_forward(message: Bytes, attestation: Bytes)`.
 * - A GOLDEN VECTOR from a successful mainnet Base → Stellar transfer
 *   (tx b2424716…3f53, ledger 64616672), asserted in the spec file.
 *
 * ## Correction (2026-09-26)
 *
 * The first version of this file (2026-08-04) wrote Circle's
 * Forwarding-Service magic `cctp-forward` into the hook header and put the
 * recipient's 32 raw key bytes in the body. Circle had not yet published
 * the Stellar layout; that encoding was a guess, and it was wrong on both
 * counts. The published layout, confirmed byte-for-byte by the mainnet
 * vector, is ZERO magic and the strkey STRING. The mainnet gate
 * (`isStellarCctpEnabled`) is why the guess never met real money.
 */

import {
  Address,
  Asset,
  Networks,
  StrKey,
  nativeToScVal,
  xdr,
} from "@stellar/stellar-base";

/** Circle-issued domain id for Stellar. Domains are unrelated to chain ids. */
export const STELLAR_CCTP_DOMAIN = 27;

/**
 * Stellar USDC has SEVEN decimals. Every other CCTP chain has six, and the
 * `amount` inside a CCTP message is ALWAYS six-decimal subunits whichever
 * direction it travels (Circle, "USDC precision for CCTP and Stellar").
 *
 * Named so the asymmetry is testable, NOT so it can be used as a shared
 * default: amounts always come from the token metadata the adapter
 * resolves (§6). A shared `USDC_DECIMALS = 6` misprices Stellar by 10x.
 */
export const STELLAR_USDC_DECIMALS = 7;
export const EVM_USDC_DECIMALS = 6;

export type StellarCctpNetwork = "pubnet" | "testnet";

/**
 * Pinned Stellar CCTP contract ids, verified against Circle's Stellar
 * contract-address reference.
 *
 * Treat this table as security-reviewed. A wrong forwarder address here
 * loses funds silently and irrecoverably. The mobile app pins the same
 * ids independently (`services/walletKit/stellar/cctpContracts.ts`) and
 * refuses to sign against anything else.
 */
export const STELLAR_CCTP_CONTRACTS: Record<
  StellarCctpNetwork,
  {
    tokenMessengerMinter: string;
    messageTransmitter: string;
    forwarder: string;
  }
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
 * Stellar USDC as a classic asset, `CODE:ISSUER`. The issuer strkey is
 * CASE-SENSITIVE — never fold it (`feedback_address_case_per_encoding`).
 */
export const STELLAR_USDC_ASSET: Record<StellarCctpNetwork, string> = {
  pubnet: "USDC:GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
  testnet: "USDC:GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
};

const NETWORK_PASSPHRASE: Record<StellarCctpNetwork, string> = {
  pubnet: Networks.PUBLIC,
  testnet: Networks.TESTNET,
};

/**
 * The USDC Stellar Asset Contract — the `burn_token` a Stellar-source
 * burn names. DERIVED from the pinned classic asset (the SAC id is a
 * deterministic hash of asset + network), never typed in, so it cannot
 * drift from `STELLAR_USDC_ASSET`.
 */
export function stellarUsdcSacId(network: StellarCctpNetwork): string {
  const [code, issuer] = STELLAR_USDC_ASSET[network].split(":");
  return new Asset(code, issuer).contractId(NETWORK_PASSPHRASE[network]);
}

/**
 * Standard finality. Stellar has NO Fast Transfer as a source, and a
 * Stellar destination attests on the source chain's own schedule, so
 * this is fixed rather than selectable: a parameter a caller cannot get
 * wrong.
 */
const STANDARD_FINALITY_THRESHOLD = 2000;

export class CctpParamError extends Error {
  readonly name = "CctpParamError";
}

/** 32-byte value rendered as a `0x`-prefixed hex string. */
export type Bytes32 = `0x${string}`;

/** Variable-length bytes as a `0x`-prefixed hex string. */
export type HexBytes = `0x${string}`;

function toHex(bytes: Uint8Array): HexBytes {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return `0x${out}` as HexBytes;
}

function fromHex(hex: string): Uint8Array {
  const body = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (!/^([0-9a-fA-F]{2})*$/.test(body)) {
    throw new CctpParamError("invalid_hex");
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function leftPad32(bytes: Uint8Array): Uint8Array {
  if (bytes.length > 32) {
    throw new CctpParamError("value_exceeds_32_bytes");
  }
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

/** A pinned `C…` contract id as the raw 32 bytes CCTP carries. */
function contractToBytes32(contractId: string): Uint8Array {
  if (!StrKey.isValidContract(contractId)) {
    throw new CctpParamError("invalid_contract_strkey");
  }
  return Uint8Array.from(StrKey.decodeContract(contractId));
}

/**
 * The final Stellar recipient, validated for the hook body.
 *
 * `G…` (account) and `C…` (contract) are accepted. Circle's forwarder
 * also accepts muxed `M…` accounts, but this app never produces one and
 * its trustline readiness check (§7.5) is written against the base
 * account, so an `M…` is refused rather than forwarded unchecked.
 */
function assertForwardRecipient(strkey: string): string {
  // Strkeys are canonically uppercase and case-SENSITIVE: never fold
  // (`feedback_address_case_per_encoding`).
  const value = strkey.trim();
  if (StrKey.isValidEd25519PublicKey(value) || StrKey.isValidContract(value)) {
    return value;
  }
  if (value.startsWith("M")) {
    throw new CctpParamError("muxed_address_unsupported");
  }
  throw new CctpParamError("invalid_stellar_strkey");
}

// ── 1. EVM → Stellar ──────────────────────────────────────────────────

/**
 * The `CctpForwarder` hook body, per Circle's published Stellar layout:
 *
 *   bytes  0-23   bytes24  magic, ALL ZERO (Circle-reserved)
 *   bytes 24-27   uint32   version, 0 (big-endian)
 *   bytes 28-31   uint32   L = byte length of the recipient strkey
 *   bytes 32..    bytes    the recipient STRKEY STRING, UTF-8 (56 bytes
 *                          for a G… or C…)
 *
 * NOT the Forwarding Service header. `cctp-forward` in the magic asks
 * Circle's relayer to forward, and Stellar has no Forwarding Service.
 */
export function encodeStellarForwardHook(recipientStrkey: string): HexBytes {
  const recipient = new TextEncoder().encode(
    assertForwardRecipient(recipientStrkey),
  );
  const out = new Uint8Array(32 + recipient.length);
  const view = new DataView(out.buffer);
  // bytes 0-23 stay zero.
  view.setUint32(24, 0, false);
  view.setUint32(28, recipient.length, false);
  out.set(recipient, 32);
  return toHex(out);
}

/** Read the recipient back out of a hook, validating the whole layout. */
export function decodeStellarForwardHook(hookData: string): string {
  const bytes = fromHex(hookData);
  if (bytes.length < 32) throw new CctpParamError("hook_too_short");
  if (!bytes.subarray(0, 24).every((b) => b === 0)) {
    throw new CctpParamError("hook_magic_must_be_zero");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(24, false) !== 0) {
    throw new CctpParamError("hook_version_must_be_zero");
  }
  const length = view.getUint32(28, false);
  if (bytes.length !== 32 + length) {
    throw new CctpParamError("hook_length_mismatch");
  }
  return assertForwardRecipient(
    new TextDecoder().decode(bytes.subarray(32, 32 + length)),
  );
}

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

export interface StellarBurnParams {
  readonly destinationDomain: number;
  readonly amountRaw: bigint;
  readonly burnToken: `0x${string}`;
  readonly mintRecipient: Bytes32;
  readonly destinationCaller: Bytes32;
  readonly maxFeeRaw: bigint;
  readonly minFinalityThreshold: number;
  readonly hookData: HexBytes;
  /** The recipient the hook carries, for assertion against the quote. */
  readonly recipientStrkey: string;
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

  const forwarder = toHex(leftPad32(contractToBytes32(contracts.forwarder)));
  const recipientStrkey = assertForwardRecipient(input.recipientStrkey);

  const params: StellarBurnParams = Object.freeze({
    destinationDomain: STELLAR_CCTP_DOMAIN,
    amountRaw: input.amountRaw,
    burnToken: input.burnToken,
    // Both point at the forwarder. Not a coincidence, not a caller choice.
    mintRecipient: forwarder,
    destinationCaller: forwarder,
    maxFeeRaw: input.maxFeeRaw,
    minFinalityThreshold: STANDARD_FINALITY_THRESHOLD,
    hookData: encodeStellarForwardHook(recipientStrkey),
    recipientStrkey,
    forwarderContractId: contracts.forwarder,
  });

  // Belt and braces: assert the invariant on the way out, so a future
  // refactor that reintroduces caller-supplied recipients trips here
  // rather than in production.
  assertBurnParamsSafe(params);
  return params;
}

/**
 * The §5.4.1 invariant as a runtime assertion, so it holds even for a
 * hand-built `StellarBurnParams`.
 */
export function assertBurnParamsSafe(params: StellarBurnParams): void {
  if (params.destinationDomain !== STELLAR_CCTP_DOMAIN) {
    throw new CctpParamError("destination_domain_must_be_stellar");
  }
  if (params.mintRecipient !== params.destinationCaller) {
    throw new CctpParamError("mint_recipient_must_equal_destination_caller");
  }
  const expected = toHex(
    leftPad32(contractToBytes32(params.forwarderContractId)),
  );
  if (params.mintRecipient !== expected) {
    throw new CctpParamError("mint_recipient_must_be_cctp_forwarder");
  }
  // Decoding validates magic (zero), version, length and the strkey, and
  // proves the hook names the recipient the caller asked for.
  if (decodeStellarForwardHook(params.hookData) !== params.recipientStrkey) {
    throw new CctpParamError("hook_recipient_mismatch");
  }
}

/**
 * Convert a 6-decimal source USDC amount to Stellar's 7-decimal units.
 * The one place the asymmetry is handled on the inbound side.
 */
export function sourceUsdcToStellarUnits(amountRaw: bigint): bigint {
  return amountRaw * 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);
}

export function stellarUnitsToSourceUsdc(amountRaw: bigint): bigint {
  return amountRaw / 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);
}

// ── 2. The Stellar claim that completes EVM → Stellar ─────────────────

export interface SorobanInvocation {
  readonly contractId: string;
  readonly method: string;
  /** XDR `ScVal` args, base64 each, positional. */
  readonly argsXdrBase64: readonly string[];
}

function scValBase64(value: xdr.ScVal): string {
  return value.toXDR("base64");
}

function bytesScVal(bytes: Uint8Array): xdr.ScVal {
  return xdr.ScVal.scvBytes(Buffer.from(bytes));
}

/**
 * `CctpForwarder.mint_and_forward(message, attestation)`.
 *
 * Stellar has no Forwarding Service, so an attested EVM → Stellar burn
 * sits unminted until SOMEONE calls this. Anyone may: the forwarder
 * validates the message, mints to itself, and pays the recipient encoded
 * in the burn's hook, atomically (Circle: "any failure reverts",
 * "non-custodial"). The recipient claiming their own funds is the normal
 * case (the golden-vector transaction was invoked by its own recipient).
 *
 * The contract is the PINNED forwarder, never a caller argument.
 */
export function buildMintAndForwardInvocation(input: {
  network: StellarCctpNetwork;
  messageHex: string;
  attestationHex: string;
}): SorobanInvocation {
  const contracts = STELLAR_CCTP_CONTRACTS[input.network];
  if (!contracts) throw new CctpParamError("unknown_stellar_network");
  const message = fromHex(input.messageHex);
  const attestation = fromHex(input.attestationHex);
  if (message.length === 0 || attestation.length === 0) {
    throw new CctpParamError("empty_message_or_attestation");
  }
  return Object.freeze({
    contractId: contracts.forwarder,
    method: "mint_and_forward",
    argsXdrBase64: Object.freeze([
      scValBase64(bytesScVal(message)),
      scValBase64(bytesScVal(attestation)),
    ]),
  });
}

// ── 3. Stellar → EVM ──────────────────────────────────────────────────

/**
 * Circle's Forwarding Service hook, version 0, no payload: the static
 * 32-byte value from Circle's "Transfer USDC with the Forwarding Service"
 * guide. On a Stellar-source burn it asks Circle to submit the mint on
 * the EVM destination, so the user needs no destination gas and nothing
 * on this route waits on the phone after the burn.
 */
export const FORWARDING_SERVICE_HOOK_V0: HexBytes =
  "0x636374702d666f72776172640000000000000000000000000000000000000000";

export interface StellarSourceBurnInput {
  network: StellarCctpNetwork;
  /** The Stellar account burning, `G…`. Also the Soroban `caller`. */
  callerStrkey: string;
  /** Amount in STELLAR units (7 decimals). */
  amountRaw: bigint;
  /** Destination CCTP domain (an EVM domain with Forwarding Service). */
  destinationDomain: number;
  /** EVM recipient, `0x` + 40 hex. */
  mintRecipientEvm: string;
  /** Forwarding fee cap in SIX-decimal USDC subunits (Iris units). */
  maxFeeRaw6: bigint;
}

export interface StellarSourceBurn extends SorobanInvocation {
  /**
   * The allowance the burn consumes: `TokenMessengerMinter` pulls the USDC
   * with `transfer_from(spender = itself, from = caller)`, so the caller
   * must `approve` exactly the burned amount first.
   */
  readonly approval: {
    readonly token: string;
    readonly spender: string;
    readonly amountRaw: bigint;
  };
  /** What actually leaves the account, in 7-decimal units. */
  readonly burnedRaw7: bigint;
  /** The six-decimal amount the CCTP message carries. */
  readonly messageAmountRaw6: bigint;
  readonly maxFeeRaw6: bigint;
  readonly mintRecipient: Bytes32;
}

/**
 * `TokenMessengerMinter.deposit_for_burn_with_hook(...)` from Stellar.
 *
 * Decimals, per Circle: a Stellar-source burn debits only through the
 * SIXTH decimal; the seventh stays in the account. So the amount is
 * truncated to a multiple of 10 here, and the quote shows exactly what
 * burns instead of letting the contract silently leave dust.
 *
 * `max_fee` is in `burn_token` units (seven decimals, per the contract's
 * own doc), so the six-decimal Iris fee is scaled up by 10.
 *
 * `destination_caller` is ZERO: Circle's Forwarding Service does not
 * forward to a restricted caller.
 */
export function buildStellarSourceBurn(
  input: StellarSourceBurnInput,
): StellarSourceBurn {
  const contracts = STELLAR_CCTP_CONTRACTS[input.network];
  if (!contracts) throw new CctpParamError("unknown_stellar_network");
  if (!StrKey.isValidEd25519PublicKey(input.callerStrkey)) {
    throw new CctpParamError("caller_must_be_account");
  }
  if (input.destinationDomain === STELLAR_CCTP_DOMAIN) {
    throw new CctpParamError("destination_must_not_be_stellar");
  }
  if (!/^0x[a-fA-F0-9]{40}$/.test(input.mintRecipientEvm)) {
    throw new CctpParamError("mint_recipient_must_be_evm_address");
  }
  if (input.maxFeeRaw6 < 0n) throw new CctpParamError("max_fee_out_of_range");

  const scale = 10n ** BigInt(STELLAR_USDC_DECIMALS - EVM_USDC_DECIMALS);
  const burnedRaw7 = input.amountRaw - (input.amountRaw % scale);
  const messageAmountRaw6 = burnedRaw7 / scale;
  if (messageAmountRaw6 <= input.maxFeeRaw6) {
    throw new CctpParamError("amount_does_not_cover_fee");
  }

  const mintRecipient = toHex(leftPad32(fromHex(input.mintRecipientEvm)));
  const zero32 = new Uint8Array(32);

  const args = [
    new Address(input.callerStrkey).toScVal(),
    nativeToScVal(burnedRaw7, { type: "i128" }),
    xdr.ScVal.scvU32(input.destinationDomain),
    bytesScVal(fromHex(mintRecipient)),
    new Address(stellarUsdcSacId(input.network)).toScVal(),
    bytesScVal(zero32),
    nativeToScVal(input.maxFeeRaw6 * scale, { type: "i128" }),
    xdr.ScVal.scvU32(STANDARD_FINALITY_THRESHOLD),
    bytesScVal(fromHex(FORWARDING_SERVICE_HOOK_V0)),
  ].map(scValBase64);

  return Object.freeze({
    contractId: contracts.tokenMessengerMinter,
    method: "deposit_for_burn_with_hook",
    argsXdrBase64: Object.freeze(args),
    approval: Object.freeze({
      token: stellarUsdcSacId(input.network),
      spender: contracts.tokenMessengerMinter,
      amountRaw: burnedRaw7,
    }),
    burnedRaw7,
    messageAmountRaw6,
    maxFeeRaw6: input.maxFeeRaw6,
    mintRecipient,
  });
}

/**
 * Mainnet kill switch (§9 phase 4, §10.6).
 *
 * The hook layout is now verified against Circle's published reference
 * AND a mainnet golden vector, but §10.6 still mandates a TESTNET
 * DRY-RUN of every path before mainnet: the claim leg and the
 * Stellar-source burn are new code, and the dry-run is cheap insurance
 * against permanent loss. Until `CCTP_STELLAR_MAINNET_ENABLED` is set
 * explicitly, mainnet reports a capability boundary and testnet stays
 * open for exactly that dry-run.
 */
export function isStellarCctpEnabled(
  network: StellarCctpNetwork,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (network === "testnet") return true;
  return env.CCTP_STELLAR_MAINNET_ENABLED === "true";
}
