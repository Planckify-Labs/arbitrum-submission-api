import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as nacl from "tweetnacl";

const RELAY_PUBLIC_KEY_URL = "https://relay.walletconnect.com/public-key";
const KEY_TTL_MS = 24 * 60 * 60 * 1000;
/** How far a request's timestamp may drift from our clock (either direction). */
const MAX_SKEW_MS = 15 * 60 * 1000;

/**
 * Verifies that a push delivery came from the WalletConnect relay
 * (specs/servers/push/auth.md): headers `X-Ed25519-Timestamp` and
 * `X-Ed25519-Signature` (hex) over `"{timestamp}.{body byte length}.{body}"`
 * with the relay's Ed25519 key from `GET relay.walletconnect.com/public-key`.
 * The reference implementation checks nothing else; we add a clock-skew
 * window so a captured request cannot be replayed indefinitely.
 */
@Injectable()
export class RelaySignatureService {
  private readonly logger = new Logger(RelaySignatureService.name);
  private cached: { key: Uint8Array; fetchedAt: number } | null = null;
  private inflight: Promise<Uint8Array | null> | null = null;

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return (
      (this.config.get<string>("WALLETCONNECT_PUSH_VALIDATE_SIGNATURES") ??
        "true") !== "false"
    );
  }

  async verify(args: {
    signatureHex: string | undefined;
    timestamp: string | undefined;
    rawBody: Buffer | undefined;
    now?: number;
  }): Promise<{ ok: true } | { ok: false; reason: string }> {
    const { signatureHex, timestamp, rawBody } = args;
    if (!signatureHex || !timestamp)
      return { ok: false, reason: "missing_headers" };
    if (!rawBody) return { ok: false, reason: "missing_raw_body" };
    if (!isFresh(timestamp, args.now ?? Date.now()))
      return { ok: false, reason: "stale_timestamp" };
    const key = await this.publicKey();
    if (!key) return { ok: false, reason: "no_relay_key" };
    let sig: Uint8Array;
    try {
      sig = hexToBytes(signatureHex);
    } catch {
      return { ok: false, reason: "bad_signature_encoding" };
    }
    if (sig.length !== nacl.sign.signatureLength)
      return { ok: false, reason: "bad_signature_length" };
    const message = Buffer.concat([
      Buffer.from(`${timestamp}.${rawBody.length}.`, "utf8"),
      rawBody,
    ]);
    return nacl.sign.detached.verify(new Uint8Array(message), sig, key)
      ? { ok: true }
      : { ok: false, reason: "bad_signature" };
  }

  /** Relay key: env override, else fetched and cached for a day. */
  async publicKey(): Promise<Uint8Array | null> {
    const override = this.config.get<string>("WALLETCONNECT_RELAY_PUBLIC_KEY");
    if (override) {
      try {
        return hexToBytes(override.trim());
      } catch {
        this.logger.error("WALLETCONNECT_RELAY_PUBLIC_KEY is not valid hex");
        return null;
      }
    }
    if (this.cached && Date.now() - this.cached.fetchedAt < KEY_TTL_MS)
      return this.cached.key;
    if (!this.inflight) {
      this.inflight = this.fetchKey().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async fetchKey(): Promise<Uint8Array | null> {
    try {
      const res = await fetch(RELAY_PUBLIC_KEY_URL, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const key = hexToBytes((await res.text()).trim());
      if (key.length !== nacl.sign.publicKeyLength)
        throw new Error("unexpected key length");
      this.cached = { key, fetchedAt: Date.now() };
      return key;
    } catch (err) {
      this.logger.warn(
        `relay public key fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return this.cached?.key ?? null;
    }
  }
}

/** Accepts unix seconds or milliseconds; refuses anything outside the skew window. */
export function isFresh(timestamp: string, now: number): boolean {
  if (!/^\d{1,16}$/.test(timestamp)) return false;
  const n = Number(timestamp);
  const ms = n > 1e12 ? n : n * 1000;
  return Math.abs(now - ms) <= MAX_SKEW_MS;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(clean))
    throw new Error("bad hex");
  return new Uint8Array(Buffer.from(clean, "hex"));
}
