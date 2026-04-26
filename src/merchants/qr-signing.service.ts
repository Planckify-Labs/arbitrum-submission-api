import { type KeyObject, createPrivateKey, createPublicKey } from "node:crypto";
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { type JWK, SignJWT, importSPKI, jwtVerify } from "jose";

/**
 * JWS-signing pipeline for TakumiPay merchant QRs (§4.4).
 *
 * Key material lives only in `TAKUMIPAY_QR_PRIVATE_KEY_PEM`. **Never logged,
 * never returned in a response, never mirrored.** The service lazy-loads
 * the PEM on first sign() so tests can inject a fake key via
 * `setTestPrivateKey()` without the module throwing at import time — the
 * task-file rule "Do not load the PEM at module-import time if tests don't
 * have the env var" is enforced by the `loadPrivateKey()` memo below.
 *
 * Wire format produced: `takumipay:v1:<compact-JWS>`, matching the prefix
 * the mobile detector (task 05) recognises. Claims follow spec §4.4:
 *
 *   {
 *     merchantId,        // ULID
 *     merchantName,      // == displayName; echoed for JWS consumers
 *     displayName,       // same value — kept for symmetry with §6.1
 *     country: "ID",
 *     currency: "IDR",
 *     amountMinor: null, // merchant QR is amount-open; payer types the amount
 *     qrisPan?: string,  // present only if the sticker was linked
 *     iat: unix-seconds
 *   }
 *
 * No `exp` claim — QRs never expire. Revocation is handled server-side
 * at intent-creation time (merchant.isActive check). JWS signature proves
 * TakumiPay issued it; the server decides whether to honor it.
 *
 * JOSE header: `{ alg: "ES256", typ: "JWT", kid: TAKUMIPAY_QR_KID }`.
 *
 * Kid rotation: `TAKUMIPAY_QR_KID` and the matching public JWK are bumped
 * together via EAS OTA + env rotation (§4.4 final paragraph). The detector
 * picks the verifier key by kid, so annual rotation never reprints
 * stickers — a fresh JWS can ship with the same merchantId payload.
 */
@Injectable()
export class QrSigningService {
  private readonly logger = new Logger(QrSigningService.name);
  private cachedKey: KeyObject | null = null;

  constructor(private readonly config: ConfigService) {}

  /**
   * Sign a merchant-QR payload and return the full `takumipay:v1:...` wire
   * string. Safe to emit to the client.
   */
  async signMerchantQr(input: {
    merchantId: string;
    displayName: string;
    country: string;
    qrisPan?: string | null;
  }): Promise<{
    jws: string;
    wire: string;
    iat: number;
    kid: string;
  }> {
    const key = this.loadPrivateKey();
    const kid = this.config.get<string>("TAKUMIPAY_QR_KID") ?? "2026-04-20";
    const iat = Math.floor(Date.now() / 1000);

    const claims: Record<string, unknown> = {
      merchantId: input.merchantId,
      merchantName: input.displayName,
      displayName: input.displayName,
      country: input.country,
      currency: "IDR",
      amountMinor: null,
    };
    if (input.qrisPan) {
      claims.qrisPan = input.qrisPan;
    }

    const jws = await new SignJWT(claims)
      .setProtectedHeader({ alg: "ES256", typ: "JWT", kid })
      .setIssuedAt(iat)
      .sign(key);

    return {
      jws,
      wire: `takumipay:v1:${jws}`,
      iat,
      kid,
    };
  }

  /**
   * Test hook — injects a private key so unit tests can exercise the full
   * sign → verify round-trip without the env var. Never called in prod.
   *
   * Accepts a `KeyObject` produced by `crypto.createPrivateKey` (the same
   * type the lazy loader produces). The matching test key is generated
   * with `crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })`.
   */
  setTestPrivateKey(key: KeyObject): void {
    this.cachedKey = key;
  }

  async verifyAndExtractMerchantId(scannedPayload: string): Promise<string> {
    const prefix = "takumipay:v1:";
    if (!scannedPayload.startsWith(prefix)) {
      throw new BadRequestException({
        message: "scannedPayload must start with 'takumipay:v1:'.",
        code: "INVALID_QR_FORMAT",
      });
    }
    const jws = scannedPayload.slice(prefix.length);
    const publicKey = this.loadPublicKey();
    const publicPem = publicKey
      .export({ format: "pem", type: "spki" })
      .toString();
    const key = await importSPKI(publicPem, "ES256");
    try {
      const { payload } = await jwtVerify(jws, key, {
        algorithms: ["ES256"],
      });
      const merchantId = payload.merchantId;
      if (typeof merchantId !== "string") {
        throw new BadRequestException({
          message: "JWS payload missing merchantId claim.",
          code: "INVALID_QR_CLAIMS",
        });
      }
      return merchantId;
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      throw new BadRequestException({
        message: "QR signature verification failed.",
        code: "QR_SIGNATURE_INVALID",
      });
    }
  }

  private loadPublicKey(): KeyObject {
    const privateKey = this.loadPrivateKey();
    return createPublicKey(privateKey);
  }

  /**
   * Lazy-load the signing PEM. First call parses + caches; subsequent calls
   * return the cached handle. Deferring the read past module init is load-
   * bearing for tests — without it, importing this module with an unset
   * env var would crash the whole Nest dependency graph during `jest`.
   *
   * Accepts either SEC1 (`-----BEGIN EC PRIVATE KEY-----`) or PKCS#8
   * (`-----BEGIN PRIVATE KEY-----`) encodings. Node's `createPrivateKey`
   * picks the right format automatically from the header.
   */
  private loadPrivateKey(): KeyObject {
    if (this.cachedKey) return this.cachedKey;

    const pem = this.config.get<string>("TAKUMIPAY_QR_PRIVATE_KEY_PEM");
    if (!pem) {
      throw new ServiceUnavailableException({
        message:
          "TAKUMIPAY_QR_PRIVATE_KEY_PEM is not configured. The signing key must be provisioned in the API env.",
        code: "QR_SIGNING_KEY_UNAVAILABLE",
      });
    }

    try {
      // Accept both literal multi-line blocks and escaped "\n" strings —
      // `.env` parsers vary between pnpm scripts and Docker, so we
      // normalize both forms.
      const normalized = pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem;
      const key = createPrivateKey({ key: normalized, format: "pem" });
      if (key.asymmetricKeyType !== "ec") {
        throw new Error(
          `expected EC key, got ${key.asymmetricKeyType ?? "unknown"}`,
        );
      }
      this.cachedKey = key;
      return key;
    } catch (err) {
      // NEVER log the PEM — only the failure class.
      const reason = err instanceof Error ? err.message : "unknown";
      this.logger.error(`TAKUMIPAY_QR_PRIVATE_KEY_PEM parse failed: ${reason}`);
      throw new ServiceUnavailableException({
        message:
          "TAKUMIPAY_QR_PRIVATE_KEY_PEM could not be parsed as an ES256 PEM.",
        code: "QR_SIGNING_KEY_INVALID",
      });
    }
  }
}

/**
 * Test helper — exports the JWK shape the mobile detector expects so
 * unit tests can build a matching public JWK from a generated key pair.
 * Not used in production (mobile gets its JWK via EXPO_PUBLIC env var).
 */
export type TakumipayPublicJwk = JWK & {
  kty: "EC";
  crv: "P-256";
  alg: "ES256";
  kid: string;
};
