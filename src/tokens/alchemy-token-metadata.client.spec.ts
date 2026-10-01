import { ConfigService } from "@nestjs/config";
import { getPublicClientForChain } from "../strategies/targets/rpc";
import type { ValkeyService } from "../valkey/valkey.service";
import { AlchemyTokenMetadataClient } from "./alchemy-token-metadata.client";

jest.mock("../strategies/targets/rpc", () => ({
  getPublicClientForChain: jest.fn(),
}));

/**
 * `alchemy_getTokenMetadata` rides the chain's RPC route (the rpc proxy,
 * forwarding to Alchemy). Until 2026-10-01 a missing ALCHEMY_API_KEY meant
 * every icon resolved to null even though the proxy could answer.
 */
const EURC = "0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1";
const valkey = {
  get: jest.fn(async () => null),
  set: jest.fn(async () => undefined),
} as unknown as ValkeyService;
const client = (env: Record<string, string> = {}) =>
  new AlchemyTokenMetadataClient(
    { get: (k: string) => env[k] } as unknown as ConfigService,
    valkey,
  );

describe("AlchemyTokenMetadataClient", () => {
  beforeEach(() => jest.clearAllMocks());

  it("answers through the chain's RPC route with no Alchemy key", async () => {
    const request = jest.fn(async () => ({
      symbol: "EURC",
      decimals: 6,
      logo: "https://static.alchemyapi.io/images/assets/20641.png",
    }));
    (getPublicClientForChain as jest.Mock).mockReturnValue({ request });
    const id = await client().getIdentity(1, EURC);
    expect(request).toHaveBeenCalledWith({
      method: "alchemy_getTokenMetadata",
      params: [EURC],
    });
    expect(id).toEqual({
      symbol: "EURC",
      decimals: 6,
      logo: "https://static.alchemyapi.io/images/assets/20641.png",
    });
  });

  it("degrades to nulls when the route's provider does not serve the method", async () => {
    (getPublicClientForChain as jest.Mock).mockReturnValue({
      request: jest.fn(async () => {
        throw new Error("the method alchemy_getTokenMetadata does not exist");
      }),
    });
    expect(await client().getIdentity(5042, EURC)).toEqual({
      symbol: null,
      logo: null,
      decimals: null,
    });
  });

  it("keeps Alchemy's null logo as null (Arc tokens have none today)", async () => {
    (getPublicClientForChain as jest.Mock).mockReturnValue({
      request: jest.fn(async () => ({ symbol: "EURC", decimals: 6, logo: null })),
    });
    const id = await client().getIdentity(5042, EURC);
    expect(id.logo).toBeNull();
    expect(id.symbol).toBe("EURC");
  });
});
