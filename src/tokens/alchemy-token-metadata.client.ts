import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { alchemyNetworkForChainId } from "../alchemy/alchemy-networks";
import { ValkeyService } from "../valkey/valkey.service";

/**
 * Token identity from Alchemy's Token API (`alchemy_getTokenMetadata`):
 * symbol, logo, and decimals.
 *
 * `decimals` is what turns the raw integer in an `approve` calldata into the
 * amount a person reads and types — without it the dApp approval sheet has to
 * show `115792089...` and make the user enter `6000000` to approve six. It is
 * the scale, so it is worth being explicit about where it comes from:
 * Alchemy reads `decimals()` off the contract, the same call the wallet makes
 * itself, so this is a cached on-chain value rather than vendor-invented
 * data, and it reaches the device over TLS through our own backend.
 *
 * Range-checked on the way out all the same (see `safeDecimals`). A value
 * outside 0-36 cannot be a real token scale, and letting one through would
 * rescale an approval by orders of magnitude.
 *
 * Mirrors `AlchemyPricesClient`: `ConfigService` key, Valkey cache, and a
 * fail-to-null posture — a miss, a timeout, or a bad key degrades to nulls
 * and never throws into the request.
 */
export interface AlchemyTokenIdentity {
  symbol: string | null;
  logo: string | null;
  decimals: number | null;
}

/** Metadata is near-immutable; a week is cheap and keeps the sheet instant. */
const IDENTITY_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * Misses are cached too, but briefly: a token can be listed on Alchemy after
 * we first ask, and a week-long "unknown" would outlive the fix.
 */
const MISS_CACHE_TTL_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 4000;

interface AlchemyTokenMetadataResult {
  name?: string | null;
  symbol?: string | null;
  decimals?: number | null;
  logo?: string | null;
}

/** Unwrap undici's generic `TypeError: fetch failed` to surface DNS/conn codes. */
function describeFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  if (err.name === "AbortError") return "request aborted (timeout)";
  const parts: string[] = [err.message || err.name];
  let cause: unknown = (err as { cause?: unknown }).cause;
  while (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    parts.push(code ? `${cause.message} (${code})` : cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return parts.join(" -> ");
}

const EMPTY: AlchemyTokenIdentity = {
  symbol: null,
  logo: null,
  decimals: null,
};

/**
 * Token scales live in a narrow band; ERC-20 tops out at 18 in practice and
 * `uint8` caps it at 255. Anything outside 0-36 is a broken or hostile
 * answer, and a wrong scale here multiplies an approval by powers of ten, so
 * it is dropped rather than passed on.
 */
function safeDecimals(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= 0 && value <= 36 ? value : null;
}

/**
 * Only http(s) URLs are passed through. Alchemy is a trusted source, but the
 * value ends up in an `<Image src>` on a signing screen, and a `javascript:`
 * or `data:` URL arriving from any upstream is not something to hand a
 * renderer unchecked.
 */
function safeLogoUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

@Injectable()
export class AlchemyTokenMetadataClient {
  private readonly logger = new Logger(AlchemyTokenMetadataClient.name);
  private readonly apiKey: string | null;

  constructor(
    private readonly configService: ConfigService,
    private readonly valkeyService: ValkeyService,
  ) {
    this.apiKey =
      this.configService.get<string>("ALCHEMY_API_KEY") ??
      // Deploy-order fallback, see AlchemyPricesClient.
      this.configService.get<string>("ALCHEMY_PRICES_API_KEY") ??
      null;
    if (!this.apiKey) {
      this.logger.warn(
        "ALCHEMY_API_KEY not configured — token icons will resolve to null.",
      );
    }
  }

  private cacheKey(network: string, address: string): string {
    return `alchemy-token-meta:${network}:${address.toLowerCase()}`;
  }

  /**
   * Identity for one token contract. Never throws: every failure path returns
   * `{ symbol: null, logo: null }`, which the caller renders as a plain
   * address exactly as it did before this client existed.
   */
  async getIdentity(
    chainId: number,
    address: string,
  ): Promise<AlchemyTokenIdentity> {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return EMPTY;
    const network = alchemyNetworkForChainId(chainId);
    if (!network) return EMPTY;

    const key = this.cacheKey(network, address);
    const cached = await this.valkeyService
      .get<AlchemyTokenIdentity>(key)
      .catch(() => null);
    if (cached !== null) return cached;

    if (!this.apiKey) return EMPTY;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(
        `https://${network}.g.alchemy.com/v2/${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "alchemy_getTokenMetadata",
            params: [address],
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        throw new Error(`Alchemy Token API error: ${response.statusText}`);
      }
      const body = (await response.json()) as {
        result?: AlchemyTokenMetadataResult | null;
        error?: { message?: string } | null;
      };
      if (body.error) {
        throw new Error(body.error.message ?? "Alchemy Token API error");
      }
      const result = body.result ?? null;
      const identity: AlchemyTokenIdentity = {
        symbol:
          typeof result?.symbol === "string" && result.symbol.length > 0
            ? result.symbol
            : null,
        logo: safeLogoUrl(result?.logo),
        decimals: safeDecimals(result?.decimals),
      };
      const hit =
        identity.symbol !== null ||
        identity.logo !== null ||
        identity.decimals !== null;
      await this.valkeyService
        .set(key, identity, {
          ttl: hit ? IDENTITY_CACHE_TTL_SECONDS : MISS_CACHE_TTL_SECONDS,
        })
        .catch(() => undefined);
      return identity;
    } catch (error: unknown) {
      this.logger.error(
        `[getIdentity] Alchemy request failed for ${network}:${address}: ${describeFetchError(error)}`,
      );
      return EMPTY;
    } finally {
      clearTimeout(timer);
    }
  }
}
