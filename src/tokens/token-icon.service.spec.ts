import type { ConfigService } from "@nestjs/config";
import * as sharp from "sharp";
import type { PrismaService } from "../prisma/prisma.service";
import type { ValkeyService } from "../valkey/valkey.service";
import {
  TOKEN_ICON_SIZE,
  TokenIconService,
  isFetchableLogoUrl,
  logoVersion,
  rasterizeToIconPng,
} from "./token-icon.service";

/**
 * TokenIconService pins the contract the transfer push depends on: the URL
 * it embeds always resolves to a PNG the device can decode, no matter what
 * `Token.logoUrl` points at. The SVG case is the one that shipped broken
 * (AUSD on Monad rendered no icon), so it gets a real rasterisation test
 * through libvips rather than a mock.
 */

const SVG_LOGO = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24"><circle cx="12" cy="12" r="10" fill="#e11d48"/></svg>',
);

function tinyPng(width: number, height: number): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 20, b: 30, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

function configStub(publicApiUrl?: string): ConfigService {
  return {
    get: jest.fn((key: string) =>
      key === "PUBLIC_API_URL" ? publicApiUrl : undefined,
    ),
  } as unknown as ConfigService;
}

function prismaStub(
  token: { id: string; logoUrl: string | null } | null,
): PrismaService {
  return {
    token: { findUnique: jest.fn(async () => token) },
  } as unknown as PrismaService;
}

function valkeyStub(store: Map<string, unknown> = new Map()) {
  const set = jest.fn((key: string, value: unknown) => {
    store.set(key, value);
    return Promise.resolve(true);
  });
  const get = jest.fn((key: string) => Promise.resolve(store.get(key) ?? null));
  return {
    service: { get, set } as unknown as ValkeyService,
    get,
    set,
    store,
  };
}

function imageResponse(
  body: Buffer,
  init: { status?: number; contentType?: string; contentLength?: string } = {},
): Response {
  const headers: Record<string, string> = {
    "content-type": init.contentType ?? "image/png",
  };
  if (init.contentLength) headers["content-length"] = init.contentLength;
  return new Response(new Uint8Array(body), {
    status: init.status ?? 200,
    headers,
  });
}

describe("isFetchableLogoUrl", () => {
  it.each([
    "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
    "http://cdn.example.com/logo.svg",
    "https://dsvxs4ecepqgj.cloudfront.net/tokens/AUSD/logo.svg",
  ])("accepts a public http(s) URL: %s", (url) => {
    expect(isFetchableLogoUrl(url)).toBe(true);
  });

  it.each([
    null,
    undefined,
    "",
    "not a url",
    "data:image/png;base64,iVBORw0KGgo=",
    "file:///etc/passwd",
    "ftp://example.com/logo.png",
    "https://localhost/logo.png",
    "http://127.0.0.1:4000/logo.png",
    "http://10.0.0.5/logo.png",
    "http://[::1]/logo.png",
    "http://valkey/logo.png",
    "https://printer.local/logo.png",
    "https://metadata.internal/logo.png",
  ])("rejects a non-public or non-http source: %s", (url) => {
    expect(isFetchableLogoUrl(url as string | null | undefined)).toBe(false);
  });
});

describe("logoVersion", () => {
  it("is a short stable fingerprint that changes with the URL", () => {
    const a = logoVersion("https://cdn.example.com/a.png");
    expect(a).toMatch(/^[0-9a-f]{10}$/);
    expect(logoVersion("https://cdn.example.com/a.png")).toBe(a);
    expect(logoVersion("https://cdn.example.com/b.png")).not.toBe(a);
  });
});

describe("rasterizeToIconPng", () => {
  it("renders an SVG to a square PNG at the icon size", async () => {
    const png = await rasterizeToIconPng(SVG_LOGO);
    const meta = await sharp(png).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(TOKEN_ICON_SIZE);
    expect(meta.height).toBe(TOKEN_ICON_SIZE);
    // A 24px viewBox rendered at native density would be a 24px bitmap
    // scaled up; the density bump keeps the circle crisp, which shows up
    // as real alpha coverage rather than a blurry, mostly-transparent blob.
    const { channels } = await sharp(png).stats();
    expect(channels[3]?.max).toBe(255);
  });

  it("squares a non-square raster with transparent padding", async () => {
    const png = await rasterizeToIconPng(await tinyPng(40, 20));
    const meta = await sharp(png).metadata();
    expect(meta.width).toBe(TOKEN_ICON_SIZE);
    expect(meta.height).toBe(TOKEN_ICON_SIZE);
    expect(meta.hasAlpha).toBe(true);
    // Top-left pixel lies in the padding band (2:1 image centred in a square).
    const { data } = await sharp(png)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(data[3]).toBe(0);
  });

  it("throws on bytes that are not an image", async () => {
    await expect(
      rasterizeToIconPng(
        Buffer.from("<html><body>403 Forbidden</body></html>"),
      ),
    ).rejects.toThrow();
  });
});

describe("TokenIconService.pushImageUrl", () => {
  it("points the push at our PNG route, versioned by the logo URL", () => {
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz/"),
      prismaStub(null),
      valkeyStub().service,
    );
    const logoUrl = "https://dsvxs4ecepqgj.cloudfront.net/tokens/AUSD/logo.svg";
    expect(svc.pushImageUrl({ id: "tk_ausd", logoUrl })).toBe(
      `https://api.takumipay.xyz/tokens/tk_ausd/icon.png?v=${logoVersion(logoUrl)}`,
    );
  });

  it("returns undefined for a token without a usable logo", () => {
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(null),
      valkeyStub().service,
    );
    expect(svc.pushImageUrl({ id: "tk_x", logoUrl: null })).toBeUndefined();
    expect(
      svc.pushImageUrl({ id: "tk_x", logoUrl: "http://localhost/logo.png" }),
    ).toBeUndefined();
  });

  it("without PUBLIC_API_URL falls back to the raw logo, except SVGs", () => {
    const svc = new TokenIconService(
      configStub(undefined),
      prismaStub(null),
      valkeyStub().service,
    );
    expect(
      svc.pushImageUrl({
        id: "tk_usdc",
        logoUrl:
          "https://assets.coingecko.com/coins/images/6319/small/usdc.png",
      }),
    ).toBe("https://assets.coingecko.com/coins/images/6319/small/usdc.png");
    expect(
      svc.pushImageUrl({
        id: "tk_ausd",
        logoUrl: "https://dsvxs4ecepqgj.cloudfront.net/tokens/AUSD/logo.svg",
      }),
    ).toBeUndefined();
  });

  it("treats a malformed PUBLIC_API_URL as unset", () => {
    const svc = new TokenIconService(
      configStub("not-a-url"),
      prismaStub(null),
      valkeyStub().service,
    );
    expect(
      svc.pushImageUrl({
        id: "tk_usdc",
        logoUrl: "https://cdn.example.com/usdc.png",
      }),
    ).toBe("https://cdn.example.com/usdc.png");
  });
});

describe("TokenIconService.getIconPng", () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  const AUSD = {
    id: "tk_ausd",
    logoUrl: "https://dsvxs4ecepqgj.cloudfront.net/tokens/AUSD/logo.svg",
  };

  it("fetches an SVG logo, rasterises it to PNG and caches the result", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(SVG_LOGO, { contentType: "image/svg+xml" }),
    );
    const valkey = valkeyStub();
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );

    const png = await svc.getIconPng("tk_ausd");
    expect(png).not.toBeNull();
    const meta = await sharp(png as Buffer).metadata();
    expect(meta.format).toBe("png");
    expect(meta.width).toBe(TOKEN_ICON_SIZE);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AUSD.logoUrl);
    expect((init.headers as Record<string, string>)["User-Agent"]).toMatch(
      /TakumiPay/,
    );

    expect(valkey.set).toHaveBeenCalledWith(
      `token-icon:v1:tk_ausd:${logoVersion(AUSD.logoUrl)}`,
      { png: (png as Buffer).toString("base64") },
      { ttl: 7 * 24 * 60 * 60 },
    );
  });

  it("serves a cached icon without touching upstream", async () => {
    const png = await tinyPng(8, 8);
    const valkey = valkeyStub(
      new Map([
        [
          `token-icon:v1:tk_ausd:${logoVersion(AUSD.logoUrl)}`,
          { png: png.toString("base64") },
        ],
      ]),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );

    const out = await svc.getIconPng("tk_ausd");
    expect(out?.equals(png)).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(valkey.set).not.toHaveBeenCalled();
  });

  it("honours a cached miss (does not re-fetch a known-bad logo every push)", async () => {
    const valkey = valkeyStub(
      new Map([
        [`token-icon:v1:tk_ausd:${logoVersion(AUSD.logoUrl)}`, { png: null }],
      ]),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );
    expect(await svc.getIconPng("tk_ausd")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-fetches when the logo URL changes, because the cache key is versioned", async () => {
    const stale = await tinyPng(8, 8);
    const valkey = valkeyStub(
      new Map([
        [
          `token-icon:v1:tk_ausd:${logoVersion("https://old.example.com/ausd.png")}`,
          { png: stale.toString("base64") },
        ],
      ]),
    );
    fetchMock.mockResolvedValue(
      imageResponse(SVG_LOGO, { contentType: "image/svg+xml" }),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );
    const out = await svc.getIconPng("tk_ausd");
    expect(out?.equals(stale)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns null and caches a short-lived miss when upstream refuses (403)", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(Buffer.from("<Error>AccessDenied</Error>"), {
        status: 403,
        contentType: "application/xml",
      }),
    );
    const valkey = valkeyStub();
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub({
        id: "tk_idrx",
        logoUrl:
          "https://assets.coingecko.com/coins/images/34630/large/idrx.png",
      }),
      valkey.service,
    );
    expect(await svc.getIconPng("tk_idrx")).toBeNull();
    expect(valkey.set).toHaveBeenCalledWith(
      expect.stringMatching(/^token-icon:v1:tk_idrx:/),
      { png: null },
      { ttl: 60 * 60 },
    );
  });

  it("returns null when upstream answers 200 with something that is not an image", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(Buffer.from("<html>Just a moment...</html>"), {
        contentType: "text/html",
      }),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkeyStub().service,
    );
    expect(await svc.getIconPng("tk_ausd")).toBeNull();
  });

  it("returns null on a fetch failure or timeout, and remembers it only briefly", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const valkey = valkeyStub();
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );
    await expect(svc.getIconPng("tk_ausd")).resolves.toBeNull();
    // A network blip must not blank the icon for an hour of pushes: the
    // miss is cached on the short transient TTL, not the definitive one.
    expect(valkey.set).toHaveBeenCalledWith(
      expect.stringMatching(/^token-icon:v1:tk_ausd:/),
      { png: null },
      { ttl: 60 },
    );
  });

  it("treats an upstream 5xx / 429 as transient too", async () => {
    const valkey = valkeyStub();
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );
    for (const status of [503, 429]) {
      valkey.set.mockClear();
      valkey.store.clear();
      fetchMock.mockResolvedValue(
        imageResponse(Buffer.from("busy"), {
          status,
          contentType: "text/plain",
        }),
      );
      await expect(svc.getIconPng("tk_ausd")).resolves.toBeNull();
      expect(valkey.set).toHaveBeenCalledWith(
        expect.any(String),
        { png: null },
        { ttl: 60 },
      );
    }
  });

  it("coalesces concurrent builds of the same icon into one upstream fetch", async () => {
    let release: (() => void) | undefined;
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          release = () =>
            resolve(imageResponse(SVG_LOGO, { contentType: "image/svg+xml" }));
        }),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkeyStub().service,
    );
    // Push-time warm-up and the device's own request, back to back.
    const first = svc.getIconPng("tk_ausd");
    const second = svc.getIconPng("tk_ausd");
    await new Promise((r) => setImmediate(r));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    release?.();
    const [a, b] = await Promise.all([first, second]);
    expect(a).not.toBeNull();
    expect(b?.equals(a as Buffer)).toBe(true);
  });

  it("warm() pre-builds the icon without throwing, and is a no-op without PUBLIC_API_URL", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(SVG_LOGO, { contentType: "image/svg+xml" }),
    );
    const valkey = valkeyStub();
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkey.service,
    );
    svc.warm(AUSD);
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(valkey.store.size).toBe(1);

    fetchMock.mockClear();
    const unconfigured = new TokenIconService(
      configStub(undefined),
      prismaStub(AUSD),
      valkeyStub().service,
    );
    unconfigured.warm(AUSD);
    await new Promise((r) => setTimeout(r, 20));
    // Without the public URL the push embeds the raw logo, so there is
    // nothing of ours for the device to fetch and nothing to pre-build.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses oversized upstream bodies by declared length", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(SVG_LOGO, {
        contentType: "image/svg+xml",
        contentLength: String(50 * 1024 * 1024),
      }),
    );
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      valkeyStub().service,
    );
    expect(await svc.getIconPng("tk_ausd")).toBeNull();
  });

  it("never fetches for a token without a fetchable logo, or an unknown token", async () => {
    const svcNoLogo = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub({ id: "tk_x", logoUrl: null }),
      valkeyStub().service,
    );
    expect(await svcNoLogo.getIconPng("tk_x")).toBeNull();

    const svcPrivate = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub({ id: "tk_y", logoUrl: "http://10.0.0.5/logo.png" }),
      valkeyStub().service,
    );
    expect(await svcPrivate.getIconPng("tk_y")).toBeNull();

    const svcMissing = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(null),
      valkeyStub().service,
    );
    expect(await svcMissing.getIconPng("tk_missing")).toBeNull();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still serves the icon when Valkey is down", async () => {
    fetchMock.mockResolvedValue(
      imageResponse(SVG_LOGO, { contentType: "image/svg+xml" }),
    );
    const brokenValkey = {
      get: jest.fn(() =>
        Promise.reject(new Error("Valkey client is not initialized")),
      ),
      set: jest.fn(() =>
        Promise.reject(new Error("Valkey client is not initialized")),
      ),
    } as unknown as ValkeyService;
    const svc = new TokenIconService(
      configStub("https://api.takumipay.xyz"),
      prismaStub(AUSD),
      brokenValkey,
    );
    const png = await svc.getIconPng("tk_ausd");
    expect(png).not.toBeNull();
    expect((await sharp(png as Buffer).metadata()).format).toBe("png");
  });
});
