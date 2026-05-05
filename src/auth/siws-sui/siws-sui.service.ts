/**
 * Sign-In-With-Sui (SIWS-Sui) verification service.
 *
 * Mirrors `SiwsService` (Solana). Uses `@mysten/sui` to:
 *   - Decode the 97-byte serialized signature (flag + sig + pubkey).
 *   - Verify the pubkey hash matches the address (BLAKE2b-256 + 0x-flag prefix).
 *   - Apply the PersonalMessage intent prefix + BLAKE2b digest internally
 *     via `Ed25519PublicKey.verifyPersonalMessage`.
 *
 * Mirrors mobile path: `kit.signAuthMessage(wallet, message)` calls
 * `keypair.signPersonalMessage(utf8Bytes)` which produces a base64
 * 97-byte serialized signature. Verification round-trips that exactly.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NonceCacheService } from "../../valkey/services/nonce-cache.service";
import {
  buildSiwsSuiMessage,
  parseSiwsSuiMessage,
  type SiwsSuiPayload,
} from "./siws-sui-message";

// `@mysten/sui` is ESM-only and the API is CommonJS, so we lazy-import
// the SDK at first use. `await import(...)` survives the `module:
// commonjs` compile (TS preserves it as a runtime call), and Node 22+
// supports loading ESM via `import()` from CommonJS without flags.
type Ed25519PublicKeyCtor = new (publicKey: Uint8Array) => {
  toSuiAddress(): string;
  verifyPersonalMessage(
    message: Uint8Array,
    signature: string,
  ): Promise<boolean>;
};
type ParseSerializedSignature = (signature: string) => {
  signatureScheme: string;
  publicKey: Uint8Array;
  signature: Uint8Array;
};
let mystenSdkCache:
  | {
      Ed25519PublicKey: Ed25519PublicKeyCtor;
      parseSerializedSignature: ParseSerializedSignature;
    }
  | null = null;
// Bypass TS module resolution — `module: commonjs` + the SDK's
// package.json `exports` map don't agree, but at runtime Node 22 loads
// the ESM build via dynamic `import()`. Wrapping in `Function()` keeps
// the compiler from trying to resolve the specifier statically.
const dynamicImport = new Function(
  "specifier",
  "return import(specifier)",
) as (specifier: string) => Promise<Record<string, unknown>>;

async function loadMystenSdk(): Promise<{
  Ed25519PublicKey: Ed25519PublicKeyCtor;
  parseSerializedSignature: ParseSerializedSignature;
}> {
  if (mystenSdkCache) return mystenSdkCache;
  const ed25519Mod = await dynamicImport("@mysten/sui/keypairs/ed25519");
  const cryptoMod = await dynamicImport("@mysten/sui/cryptography");
  mystenSdkCache = {
    Ed25519PublicKey:
      ed25519Mod.Ed25519PublicKey as unknown as Ed25519PublicKeyCtor,
    parseSerializedSignature:
      cryptoMod.parseSerializedSignature as unknown as ParseSerializedSignature,
  };
  return mystenSdkCache;
}

export interface SiwsSuiVerifyResult {
  success: boolean;
  address: string;
  domain: string;
  nonce: string;
  chainId: string;
}

@Injectable()
export class SiwsSuiService {
  private readonly logger = new Logger(SiwsSuiService.name);

  constructor(
    private readonly nonceCache: NonceCacheService,
    private readonly config: ConfigService,
  ) {}

  buildMessage(input: SiwsSuiPayload): string {
    return buildSiwsSuiMessage(input);
  }

  parseMessage(message: string): SiwsSuiPayload {
    return parseSiwsSuiMessage(message);
  }

  async verify(
    message: string,
    signature: string,
  ): Promise<SiwsSuiVerifyResult> {
    const empty: SiwsSuiVerifyResult = {
      success: false,
      address: "",
      domain: "",
      nonce: "",
      chainId: "",
    };

    try {
      const parsed = this.parseMessage(message);
      const { domain, address, nonce, chainId, expirationTime } = parsed;

      if (!domain || !address || !nonce || !chainId || !expirationTime) {
        return empty;
      }

      const expectedDomain = this.config.get<string>("SIWE_DOMAIN");
      if (!expectedDomain || domain !== expectedDomain) {
        this.logger.warn(`SIWS-Sui domain mismatch: got ${domain}`);
        return empty;
      }

      const expiresMs = Date.parse(expirationTime);
      if (isNaN(expiresMs) || Date.now() >= expiresMs) {
        return empty;
      }

      const { Ed25519PublicKey, parseSerializedSignature } =
        await loadMystenSdk();

      // Decode the wallet-standard serialized signature: flag(1) || sig(64) || pubkey(32).
      let publicKeyBytes: Uint8Array;
      try {
        const decoded = parseSerializedSignature(signature);
        if (decoded.signatureScheme !== "ED25519") {
          this.logger.warn(
            `SIWS-Sui non-ed25519 scheme rejected: ${decoded.signatureScheme}`,
          );
          return empty;
        }
        publicKeyBytes = decoded.publicKey;
      } catch (e) {
        this.logger.warn(
          `SIWS-Sui signature decode failed: ${(e as Error).message}`,
        );
        return empty;
      }

      const pubKey = new Ed25519PublicKey(publicKeyBytes);

      // Critical: ensure the pubkey actually owns the claimed address.
      // BLAKE2b-256(0x00 || pubkey).slice(0, 32) → 0x-prefixed hex address.
      if (pubKey.toSuiAddress() !== address) {
        this.logger.warn(
          `SIWS-Sui pubkey does not match address: derived=${pubKey.toSuiAddress()} claimed=${address}`,
        );
        return empty;
      }

      const messageBytes = new TextEncoder().encode(message);
      const ok = await pubKey.verifyPersonalMessage(messageBytes, signature);
      if (!ok) return empty;

      const cached = await this.nonceCache.getNonce("sui", address);
      if (!cached || cached.nonce !== nonce) {
        return empty;
      }
      await this.nonceCache.deleteNonce("sui", address);

      return {
        success: true,
        address,
        domain,
        nonce,
        chainId,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`SIWS-Sui verify failed: ${msg}`);
      return empty;
    }
  }
}
