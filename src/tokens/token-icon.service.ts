import { createHash } from "node:crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as sharp from "sharp";
import { PrismaService } from "../prisma/prisma.service";
import { ValkeyService } from "../valkey/valkey.service";

/**
 * Token icons in a shape a phone notification can actually render.
 *
 * `Token.logoUrl` is whatever the catalogue was seeded with: CoinGecko PNGs,
 * the issuer's own SVG (AUSD, Aave's aTokens), a Twitter avatar JPEG, a
 * hot-linked CDN file. That is fine for the app, whose image component copes
 * with most of it, but a push notification is different: on Android
 * expo-notifications fetches `richContent.image` with a bare
 * `URL.openConnection()` and runs `BitmapFactory.decodeStream` on the bytes.
 * No SVG support, no `User-Agent`, and any failure is swallowed as
 * "no large icon". That is why a native transfer (PNG logo) showed an icon
 * and an AUSD transfer (SVG logo) did not — the chain is irrelevant, the
 * file format is not.
 *
 * So instead of handing the device an upstream URL of unknown shape, the
 * push points at `GET /tokens/:id/icon.png`, and this service turns whatever
 * `logoUrl` holds into a fixed-size PNG: fetched server-side with a real
 * User-Agent, rasterised (SVG included) and squared by libvips, cached in
 * Valkey. The token row is the only input, so every namespace — EVM, Solana,
 * Sui, Stellar, whatever comes next — gets the same treatment without a
 * per-chain branch anywhere.
 *
 * Fail-to-null throughout: a dead upstream, a non-image, a decode failure or
 * a Valkey hiccup degrades to "no icon" (the notification still ships with
 * title/body), never to a thrown error in the push path or a 500 on the
 * icon route.
 */
export interface TokenIconSource {
  id: string;
  logoUrl: string | null;
}

/**
 * Output edge in pixels. Android's notification large icon is 64dp, which
 * is 256px at xxxhdpi; iOS attachments (once a Notification Service
 * Extension exists) are happy with the same.
 */
export const TOKEN_ICON_SIZE = 256;

/** Logos are near-immutable; the URL carries a version so a change busts it. */
const ICON_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;
/**
 * A definitive miss (upstream 4xx, not an image, oversized) will not fix
 * itself until someone edits `logoUrl`, which changes the cache key anyway,
 * so an hour just stops us re-asking on every push.
 */
const MISS_CACHE_TTL_SECONDS = 60 * 60;
/**
 * A transient miss (timeout, DNS/TLS hiccup, upstream 5xx/429) is remembered
 * only long enough to not hammer a struggling host. Seen in dev: one cold
 * request timed out while the server was restarting, and with a one-hour
 * miss TTL every transfer push in that hour would have shipped without an
 * icon for a logo that was perfectly reachable.
 */
const TRANSIENT_MISS_CACHE_TTL_SECONDS = 60;
const FETCH_TIMEOUT_MS = 6000;
/** Upstream bodies beyond this are dropped unread — a logo is tens of KB. */
const MAX_UPSTREAM_BYTES = 4 * 1024 * 1024;
/** Decompression-bomb guard for libvips (`limitInputPixels`). */
const MAX_INPUT_PIXELS = 4096 * 4096;
/** libvips caps SVG density at this; also keeps a 1x1 viewBox from exploding. */
const MAX_SVG_DENSITY = 2400;
const CACHE_KEY_VERSION = "v1";

const FETCH_HEADERS = {
  // Some logo hosts (CDN hot-link rules, Cloudflare bot checks) refuse
  // Android's default `Dalvik/…` UA outright — one of the two ways a
  // non-native icon went missing. Present as a normal client instead.
  "User-Agent":
    "Mozilla/5.0 (compatible; TakumiPay/1.0; +https://takumipay.xyz)",
  Accept:
    "image/png,image/jpeg,image/webp,image/svg+xml,image/*;q=0.9,*/*;q=0.5",
};

/** What Valkey holds per (token, logo version). `null` png = cached miss. */
interface CachedIcon {
  png: string | null;
}

/** One build attempt; `transient` decides how long a miss is remembered. */
interface BuildResult {
  png: Buffer | null;
  transient: boolean;
}

/** Hostnames a catalogue logo must never point at, even if an admin typed one. */
const BLOCKED_HOSTNAMES = new Set(["localhost", "0.0.0.0"]);

/**
 * Only http(s) URLs on a public-looking hostname. `logoUrl` is admin data,
 * not user input, but this service performs a server-side fetch on it, so
 * it gets the same posture as any other outbound URL: no `file:`/`data:`,
 * no loopback, no raw IP literals, no `.local`/`.internal` names.
 */
export function isFetchableLogoUrl(
  value: string | null | undefined,
): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) return false;
  if (host.startsWith("[")) return false; // IPv6 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false; // IPv4 literal
  if (host.endsWith(".local") || host.endsWith(".internal")) return false;
  if (!host.includes(".")) return false; // bare single-label names
  return true;
}

/**
 * Short, stable fingerprint of the upstream URL. Goes into both the Valkey
 * key and the `?v=` of the public URL, so changing `Token.logoUrl` produces a
 * new URL (device/CDN caches miss) and a new cache slot (we re-fetch).
 */
export function logoVersion(logoUrl: string): string {
  return createHash("sha1").update(logoUrl).digest("hex").slice(0, 10);
}

/** `.svg`/`.svgz` by path is the one shape we know the device can't decode. */
function isSvgByPath(logoUrl: string): boolean {
  try {
    return /\.svgz?$/i.test(new URL(logoUrl).pathname);
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\/+$/, "");
  if (trimmed.length === 0) return null;
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  } catch {
    return null;
  }
  return trimmed;
}

/**
 * Normalise any decodable image (PNG/JPEG/WebP/GIF/SVG/…) to a square,
 * transparent-padded PNG of `TOKEN_ICON_SIZE`. Throws on undecodable input;
 * the caller maps that to a miss.
 */
export async function rasterizeToIconPng(input: Buffer): Promise<Buffer> {
  const meta = await sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
  }).metadata();
  const edge = Math.max(meta.width ?? 0, meta.height ?? 0);
  // SVG rasterises at its intrinsic size at 72dpi. A 24x24 viewBox would
  // render as a 24px bitmap and then be upscaled — blurry. Bump the density
  // so the vector is rendered straight to the output edge instead.
  const density =
    meta.format === "svg" && edge > 0
      ? Math.min(MAX_SVG_DENSITY, (72 * TOKEN_ICON_SIZE) / edge)
      : undefined;
  return sharp(input, {
    limitInputPixels: MAX_INPUT_PIXELS,
    animated: false,
    ...(density !== undefined ? { density } : {}),
  })
    .resize(TOKEN_ICON_SIZE, TOKEN_ICON_SIZE, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
}

@Injectable()
export class TokenIconService {
  private readonly logger = new Logger(TokenIconService.name);
  private readonly publicBaseUrl: string | null;
  /**
   * Builds in progress, keyed like the cache. The push-time warm-up and the
   * device's own fetch can land within the same second; this makes the
   * second one wait for the first instead of fetching and rasterising the
   * same logo twice.
   */
  private readonly inFlight = new Map<string, Promise<Buffer | null>>();

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly valkeyService: ValkeyService,
  ) {
    this.publicBaseUrl = normalizeBaseUrl(
      configService.get<string>("PUBLIC_API_URL"),
    );
    if (!this.publicBaseUrl) {
      this.logger.warn(
        "PUBLIC_API_URL not set — push notifications will embed raw Token.logoUrl values; SVG and hot-link-protected logos will show no icon on the device.",
      );
    }
  }

  /**
   * The image URL to embed in a push for this token, or `undefined` for
   * "send without an icon". Prefers our own `/tokens/:id/icon.png` (any
   * source format works); without `PUBLIC_API_URL` falls back to the raw
   * logo, skipping the one format the device provably cannot decode.
   */
  pushImageUrl(token: TokenIconSource): string | undefined {
    if (!isFetchableLogoUrl(token.logoUrl)) return undefined;
    if (!this.publicBaseUrl) {
      return isSvgByPath(token.logoUrl) ? undefined : token.logoUrl;
    }
    return `${this.publicBaseUrl}/tokens/${encodeURIComponent(token.id)}/icon.png?v=${logoVersion(token.logoUrl)}`;
  }

  /**
   * PNG bytes for `GET /tokens/:id/icon.png`; `null` when the token has no
   * usable logo. Never throws.
   */
  async getIconPng(tokenId: string): Promise<Buffer | null> {
    const token = await this.prisma.token
      .findUnique({
        where: { id: tokenId },
        select: { id: true, logoUrl: true },
      })
      .catch((err: unknown) => {
        this.logger.warn(
          `[getIconPng] token lookup failed for ${tokenId}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      });
    if (!token || !isFetchableLogoUrl(token.logoUrl)) return null;

    const key = this.cacheKey(token.id, token.logoUrl);
    const cached = await this.valkeyService
      .get<CachedIcon>(key)
      .catch(() => null);
    if (cached && typeof cached === "object" && "png" in cached) {
      return cached.png === null ? null : Buffer.from(cached.png, "base64");
    }

    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const build = this.buildAndCache(key, token.logoUrl).finally(() => {
      this.inFlight.delete(key);
    });
    this.inFlight.set(key, build);
    return build;
  }

  /**
   * Fire-and-forget pre-build, called when a push that embeds this token's
   * icon is about to go out. The device fetches the icon the moment the
   * notification arrives, on a short OS timeout and with no retry; by the
   * time Expo → FCM → handset has happened, the PNG is usually already in
   * Valkey and the device request is a cache hit. Never throws, never
   * awaited by the caller.
   */
  warm(token: TokenIconSource): void {
    if (!this.publicBaseUrl || !isFetchableLogoUrl(token.logoUrl)) return;
    void this.getIconPng(token.id).catch((err: unknown) => {
      this.logger.warn(
        `[warm] icon pre-build failed for ${token.id}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
  }

  private async buildAndCache(
    key: string,
    logoUrl: string,
  ): Promise<Buffer | null> {
    const { png, transient } = await this.buildIconPng(logoUrl);
    const ttl = png
      ? ICON_CACHE_TTL_SECONDS
      : transient
        ? TRANSIENT_MISS_CACHE_TTL_SECONDS
        : MISS_CACHE_TTL_SECONDS;
    await this.valkeyService
      .set(
        key,
        { png: png ? png.toString("base64") : null } satisfies CachedIcon,
        { ttl },
      )
      .catch(() => undefined);
    return png;
  }

  private cacheKey(tokenId: string, logoUrl: string): string {
    return `token-icon:${CACHE_KEY_VERSION}:${tokenId}:${logoVersion(logoUrl)}`;
  }

  private async buildIconPng(logoUrl: string): Promise<BuildResult> {
    const upstream = await this.fetchUpstream(logoUrl);
    if (!upstream.bytes) return { png: null, transient: upstream.transient };
    try {
      return {
        png: await rasterizeToIconPng(upstream.bytes),
        transient: false,
      };
    } catch (err: unknown) {
      this.logger.warn(
        `[buildIconPng] could not decode logo ${logoUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { png: null, transient: false };
    }
  }

  private async fetchUpstream(
    logoUrl: string,
  ): Promise<{ bytes: Buffer | null; transient: boolean }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(logoUrl, {
        headers: FETCH_HEADERS,
        redirect: "follow",
        signal: controller.signal,
      });
      if (!response.ok) {
        this.logger.warn(
          `[fetchUpstream] ${logoUrl} answered ${response.status}`,
        );
        // 5xx and 429 are the host having a bad moment; a 403/404 is the
        // URL being wrong and stays wrong until the row is edited.
        const transient = response.status >= 500 || response.status === 429;
        return { bytes: null, transient };
      }
      const declared = Number(response.headers.get("content-length"));
      if (Number.isFinite(declared) && declared > MAX_UPSTREAM_BYTES) {
        this.logger.warn(
          `[fetchUpstream] ${logoUrl} too large (${declared} bytes)`,
        );
        return { bytes: null, transient: false };
      }
      const body = await readCapped(response, MAX_UPSTREAM_BYTES);
      if (!body) {
        this.logger.warn(`[fetchUpstream] ${logoUrl} exceeded size cap`);
        return { bytes: null, transient: false };
      }
      return { bytes: body, transient: false };
    } catch (err: unknown) {
      this.logger.warn(
        `[fetchUpstream] ${logoUrl} failed: ${err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err)}`,
      );
      return { bytes: null, transient: true };
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Read the body up to `cap` bytes; `null` if the stream runs past it. */
async function readCapped(
  response: Response,
  cap: number,
): Promise<Buffer | null> {
  if (!response.body) {
    const buf = Buffer.from(await response.arrayBuffer());
    return buf.length > cap ? null : buf;
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(
    chunks.map((c) => Buffer.from(c.buffer, c.byteOffset, c.byteLength)),
  );
}
