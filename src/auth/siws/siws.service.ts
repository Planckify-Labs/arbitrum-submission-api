import { webcrypto } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  verifySignature as verifyEd25519,
  type SignatureBytes,
} from "@solana/keys";
import { getAddressEncoder, type Address } from "@solana/addresses";
import { NonceCacheService } from "../../valkey/services/nonce-cache.service";
import {
  buildSiwsMessage,
  parseSiwsMessage,
  SiwsPayload,
} from "./siws-message";

export interface SiwsVerifyResult {
  success: boolean;
  address: string;
  domain: string;
  nonce: string;
  chainId: string;
}

export function decodeSignature(sig: string): Uint8Array | null {
  try {
    const base58Decoded = decodeBase58(sig);
    if (base58Decoded && base58Decoded.length === 64) return base58Decoded;
  } catch {
    // fall through to base64
  }
  try {
    const b64 = Buffer.from(sig, "base64");
    if (b64.length === 64) return new Uint8Array(b64);
  } catch {
    // ignore
  }
  return null;
}

// Minimal base58 decoder (Bitcoin alphabet) — no dep on a heavy crypto lib.
const BASE58_ALPHABET =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX: Record<string, number> = Object.fromEntries(
  BASE58_ALPHABET.split("").map((c, i) => [c, i]),
);

function decodeBase58(input: string): Uint8Array | null {
  if (input.length === 0) return new Uint8Array();
  const bytes: number[] = [0];
  for (const c of input) {
    const v = BASE58_INDEX[c];
    if (v === undefined) return null;
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  // Preserve leading zero bytes for '1' prefix.
  let leadingZeros = 0;
  for (const c of input) {
    if (c === "1") leadingZeros++;
    else break;
  }
  const out = new Uint8Array(leadingZeros + bytes.length);
  for (let i = 0; i < leadingZeros; i++) out[i] = 0;
  for (let i = 0; i < bytes.length; i++) {
    out[leadingZeros + i] = bytes[bytes.length - 1 - i];
  }
  return out;
}

@Injectable()
export class SiwsService {
  private readonly logger = new Logger(SiwsService.name);

  constructor(
    private readonly nonceCache: NonceCacheService,
    private readonly config: ConfigService,
  ) {}

  buildMessage(input: SiwsPayload): string {
    return buildSiwsMessage(input);
  }

  parseMessage(message: string): SiwsPayload {
    return parseSiwsMessage(message);
  }

  async verify(
    message: string,
    signature: string,
  ): Promise<SiwsVerifyResult> {
    const empty: SiwsVerifyResult = {
      success: false,
      address: "",
      domain: "",
      nonce: "",
      chainId: "",
    };

    try {
      const parsed = this.parseMessage(message);
      const {
        domain,
        address,
        nonce,
        chainId,
        expirationTime,
      } = parsed;

      if (!domain || !address || !nonce || !chainId || !expirationTime) {
        return empty;
      }

      const expectedDomain = this.config.get<string>("SIWE_DOMAIN");
      if (!expectedDomain || domain !== expectedDomain) {
        this.logger.warn(`SIWS domain mismatch: got ${domain}`);
        return empty;
      }

      const expiresMs = Date.parse(expirationTime);
      if (isNaN(expiresMs) || Date.now() >= expiresMs) {
        return empty;
      }

      const sigBytes = decodeSignature(signature);
      if (!sigBytes || sigBytes.length !== 64) {
        return empty;
      }

      const pubkeyBytes = getAddressEncoder().encode(address as Address);
      if (pubkeyBytes.length !== 32) {
        return empty;
      }

      const pubkey = await webcrypto.subtle.importKey(
        "raw",
        new Uint8Array(pubkeyBytes),
        { name: "Ed25519" },
        false,
        ["verify"],
      );

      const ok = await verifyEd25519(
        pubkey,
        sigBytes as SignatureBytes,
        new TextEncoder().encode(message),
      );
      if (!ok) return empty;

      const cached = await this.nonceCache.getNonce("solana", address);
      if (!cached || cached.nonce !== nonce) {
        return empty;
      }
      await this.nonceCache.deleteNonce("solana", address);

      return {
        success: true,
        address,
        domain,
        nonce,
        chainId,
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`SIWS verify failed: ${msg}`);
      return empty;
    }
  }
}
