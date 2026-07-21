/**
 * Sign-In-With-Stellar (SIWS-Stellar) verification service.
 *
 * Mirrors `SiwsSuiService` structurally, but is simpler: `@stellar/stellar-base`
 * is a normal CJS-compatible dependency (no ESM/CJS dynamic-import
 * interop needed the way `@mysten/sui` requires). Stellar also has no
 * intent-prefix framing — `Keypair.sign`/`Keypair.verify` are raw
 * ed25519 over the exact message bytes, matching the mobile signer
 * (`StellarWalletKit.signAuthMessage` = `keypair.sign(utf8Bytes)`,
 * base64-encoded — see docs/stellar-chain-support-spec.md §4.2).
 */

import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Keypair, StrKey } from "@stellar/stellar-base";
import { NonceCacheService } from "../../valkey/services/nonce-cache.service";
import { sep53Digest } from "./sep53";
import {
  buildSiwsStellarMessage,
  parseSiwsStellarMessage,
  type SiwsStellarPayload,
} from "./siws-stellar-message";

export interface SiwsStellarVerifyResult {
  success: boolean;
  address: string;
  domain: string;
  nonce: string;
  chainId: string;
}

@Injectable()
export class SiwsStellarService {
  private readonly logger = new Logger(SiwsStellarService.name);

  constructor(
    private readonly nonceCache: NonceCacheService,
    private readonly config: ConfigService,
  ) {}

  buildMessage(input: SiwsStellarPayload): string {
    return buildSiwsStellarMessage(input);
  }

  parseMessage(message: string): SiwsStellarPayload {
    return parseSiwsStellarMessage(message);
  }

  async verify(
    message: string,
    signature: string,
  ): Promise<SiwsStellarVerifyResult> {
    const empty: SiwsStellarVerifyResult = {
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
        this.logger.warn(`SIWS-Stellar domain mismatch: got ${domain}`);
        return empty;
      }

      const expiresMs = Date.parse(expirationTime);
      if (isNaN(expiresMs) || Date.now() >= expiresMs) {
        return empty;
      }

      // Reject malformed StrKey up front — `StrKey.isValidEd25519PublicKey`
      // enforces the SEP-0023 checksum + round-trip guard.
      if (!StrKey.isValidEd25519PublicKey(address)) {
        this.logger.warn(`SIWS-Stellar invalid address: ${address}`);
        return empty;
      }

      let signatureBytes: Buffer;
      try {
        signatureBytes = Buffer.from(signature, "base64");
        if (signatureBytes.length !== 64) {
          throw new Error(
            `unexpected signature length ${signatureBytes.length}`,
          );
        }
      } catch (e) {
        this.logger.warn(
          `SIWS-Stellar signature decode failed: ${(e as Error).message}`,
        );
        return empty;
      }

      // SEP-53 message signing: the ed25519 signature must be over
      // `SHA-256("Stellar Signed Message:\n" ‖ message)`, which
      // domain-separates a login signature from a transaction signature.
      // A raw-UTF-8 signature (the pre-SEP-53 form) is rejected — mobile
      // and server switch to SEP-53 together. Mirrors the mobile signer
      // (mobile-app/.../stellar/sep53.ts).
      const keypair = Keypair.fromPublicKey(address);
      const ok = keypair.verify(sep53Digest(message), signatureBytes);
      if (!ok) return empty;

      const cached = await this.nonceCache.getNonce("stellar", address);
      if (!cached || cached.nonce !== nonce) {
        return empty;
      }
      // Bind the signed `Chain ID` to the network the challenge was issued
      // for, so a signature over a testnet message can't satisfy a mainnet
      // login. Skipped when the nonce predates this binding (legacy).
      if (cached.chainId && cached.chainId !== chainId) {
        this.logger.warn(
          `SIWS-Stellar chainId mismatch: message=${chainId} bound=${cached.chainId}`,
        );
        return empty;
      }
      await this.nonceCache.deleteNonce("stellar", address);

      return {
        success: true,
        address,
        domain,
        nonce,
        chainId,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`SIWS-Stellar verify failed: ${msg}`);
      return empty;
    }
  }
}
