import { createPublicKey, createVerify, X509Certificate } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

/** How far a callback's timestamp may drift from our clock (either way). */
const MAX_SKEW_MS = 15 * 60 * 1000;
/** Re-fetch a cached certificate after this long even if it still verifies. */
const CERT_TTL_MS = 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export type SignatureVerdict = { ok: true } | { ok: false; reason: string };

/**
 * Verifies that a wallet-activity callback came from Zerion
 * (developers.zerion.io/webhooks → "Signature verification"): headers
 * `X-Timestamp`, `X-Signature` (base64) and `X-Certificate-URL`; the
 * signature is RSA-PKCS1v15/SHA-256 over `"{timestamp}\n{raw body}\n"`,
 * checked against the public key of the certificate at that URL.
 *
 * Two things the reference snippet does not do, added here because a
 * forged callback would ring users' phones:
 *   - the certificate URL is pinned to Zerion's own hosts, so an attacker
 *     cannot point us at a certificate they control;
 *   - the timestamp must be fresh, so a captured request cannot be
 *     replayed indefinitely (the dedupe key catches exact replays anyway).
 *
 * The certificate is cached per URL; on a verification miss it is fetched
 * once more in case Zerion rotated it, and only then is the request
 * rejected.
 */
@Injectable()
export class ZerionWebhookSignatureService {
  private readonly logger = new Logger(ZerionWebhookSignatureService.name);
  private readonly certs = new Map<
    string,
    { pem: string; fetchedAt: number }
  >();
  private readonly inflight = new Map<string, Promise<string | null>>();

  constructor(private readonly config: ConfigService) {}

  get enabled(): boolean {
    return (
      (this.config.get<string>("ZERION_WEBHOOK_VALIDATE_SIGNATURES") ??
        "true") !== "false"
    );
  }

  async verify(args: {
    timestamp: string | undefined;
    signatureB64: string | undefined;
    certificateUrl: string | undefined;
    rawBody: Buffer | undefined;
    now?: number;
  }): Promise<SignatureVerdict> {
    const { timestamp, signatureB64, certificateUrl, rawBody } = args;
    if (!timestamp || !signatureB64 || !certificateUrl) {
      return { ok: false, reason: "missing_headers" };
    }
    if (!rawBody) return { ok: false, reason: "missing_raw_body" };
    if (!isFresh(timestamp, args.now ?? Date.now())) {
      return { ok: false, reason: "stale_timestamp" };
    }
    if (!isAllowedCertificateUrl(certificateUrl)) {
      return { ok: false, reason: "certificate_host_not_allowed" };
    }

    const message = Buffer.concat([
      Buffer.from(`${timestamp}\n`, "utf8"),
      rawBody,
      Buffer.from("\n", "utf8"),
    ]);

    let pem = await this.certificate(certificateUrl, false);
    if (!pem) return { ok: false, reason: "certificate_unavailable" };
    if (verifyWith(pem, message, signatureB64)) return { ok: true };

    // Miss: maybe the certificate rotated under a stable URL.
    pem = await this.certificate(certificateUrl, true);
    if (pem && verifyWith(pem, message, signatureB64)) return { ok: true };
    return { ok: false, reason: "bad_signature" };
  }

  private async certificate(
    url: string,
    force: boolean,
  ): Promise<string | null> {
    const cached = this.certs.get(url);
    if (!force && cached && Date.now() - cached.fetchedAt < CERT_TTL_MS) {
      return cached.pem;
    }
    let pending = this.inflight.get(url);
    if (!pending) {
      pending = this.fetchCertificate(url).finally(() => {
        this.inflight.delete(url);
      });
      this.inflight.set(url, pending);
    }
    const pem = await pending;
    if (pem) this.certs.set(url, { pem, fetchedAt: Date.now() });
    return pem ?? cached?.pem ?? null;
  }

  private async fetchCertificate(url: string): Promise<string | null> {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(
          `[zerion-signature] certificate fetch ${url} → HTTP ${response.status}`,
        );
        return null;
      }
      const pem = (await response.text()).trim();
      // Reject anything that is not key material up front, so a
      // captive-portal HTML page never gets handed to `verify`. Zerion
      // serves an X.509 certificate; a bare public key is accepted too.
      return parseVerifierPem(pem);
    } catch (err) {
      this.logger.warn(
        `[zerion-signature] certificate fetch ${url} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
  }
}

/** The PEM as `verify` wants it, or `null` when it is neither cert nor key. */
export function parseVerifierPem(pem: string): string | null {
  try {
    return new X509Certificate(pem).publicKey.export({
      type: "spki",
      format: "pem",
    }) as string;
  } catch {
    // not a certificate
  }
  try {
    return createPublicKey(pem).export({
      type: "spki",
      format: "pem",
    }) as string;
  } catch {
    return null;
  }
}

function verifyWith(pem: string, message: Buffer, signatureB64: string) {
  try {
    const verifier = createVerify("RSA-SHA256");
    verifier.update(message);
    return verifier.verify(pem, signatureB64, "base64");
  } catch {
    return false;
  }
}

function isFresh(timestamp: string, now: number): boolean {
  const t = Date.parse(timestamp);
  if (!Number.isFinite(t)) return false;
  return Math.abs(now - t) <= MAX_SKEW_MS;
}

/** Only https, only Zerion's own domains. */
export function isAllowedCertificateUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase();
  return host === "zerion.io" || host.endsWith(".zerion.io");
}
