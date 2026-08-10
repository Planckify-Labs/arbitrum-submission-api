import {
  resolveRpcEndpoint,
  resolveRpcUrl,
  withResolvedRpcUrl,
} from "./rpc-endpoint";

describe("resolveRpcEndpoint", () => {
  const original = {
    url: process.env.RPC_PROXY_URL,
    key: process.env.RPC_PROXY_API_KEY,
  };

  afterEach(() => {
    process.env.RPC_PROXY_URL = original.url;
    process.env.RPC_PROXY_API_KEY = original.key;
  });

  function configure(url?: string, key?: string) {
    if (url === undefined) delete process.env.RPC_PROXY_URL;
    else process.env.RPC_PROXY_URL = url;
    if (key === undefined) delete process.env.RPC_PROXY_API_KEY;
    else process.env.RPC_PROXY_API_KEY = key;
  }

  it("joins a route onto the configured proxy origin", () => {
    configure("https://rpc.takumipay.com");
    expect(resolveRpcEndpoint("/evm/1").url).toBe(
      "https://rpc.takumipay.com/evm/1",
    );
    expect(resolveRpcEndpoint("/solana/mainnet").url).toBe(
      "https://rpc.takumipay.com/solana/mainnet",
    );
  });

  it("does not double up slashes when the origin has a trailing one", () => {
    configure("https://rpc.takumipay.com/");
    expect(resolveRpcUrl("/evm/137")).toBe("https://rpc.takumipay.com/evm/137");
  });

  it("attaches the bearer only when a proxy key is configured", () => {
    configure("https://rpc.takumipay.com", "secret");
    expect(resolveRpcEndpoint("/evm/1").headers).toEqual({
      Authorization: "Bearer secret",
    });

    // rpc-proxy disables auth when its own PROXY_API_KEY is unset.
    configure("https://rpc.takumipay.com", "");
    expect(resolveRpcEndpoint("/evm/1").headers).toEqual({});
  });

  it("passes absolute URLs through untouched and unauthenticated", () => {
    // A row predating the proxy cutover. Sending our proxy bearer to a
    // third-party upstream would leak the token, so headers must stay empty.
    configure("https://rpc.takumipay.com", "secret");
    const upstream = "https://eth-mainnet.g.alchemy.com/v2/abc123";
    expect(resolveRpcEndpoint(upstream)).toEqual({
      url: upstream,
      headers: {},
    });
  });

  it("throws when a route is stored but no proxy origin is configured", () => {
    configure(undefined, undefined);
    expect(() => resolveRpcEndpoint("/evm/1")).toThrow(
      /RPC_PROXY_URL is not set/,
    );
  });

  it("still resolves absolute URLs with no proxy origin configured", () => {
    configure(undefined, undefined);
    expect(resolveRpcUrl("https://rpc.monad.xyz")).toBe(
      "https://rpc.monad.xyz",
    );
  });

  it("withResolvedRpcUrl rewrites only rpcUrl and does not mutate the row", () => {
    configure("https://rpc.takumipay.com");
    const row = { id: "01ETH", name: "Ethereum", rpcUrl: "/evm/1" };
    const out = withResolvedRpcUrl(row);

    expect(out).toEqual({
      id: "01ETH",
      name: "Ethereum",
      rpcUrl: "https://rpc.takumipay.com/evm/1",
    });
    expect(row.rpcUrl).toBe("/evm/1");
  });
});
