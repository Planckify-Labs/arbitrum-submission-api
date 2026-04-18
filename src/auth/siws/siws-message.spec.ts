import {
  buildSiwsMessage,
  parseSiwsMessage,
  SiwsPayload,
  SiwsFormatError,
  chainSlugToCluster,
} from "./siws-message";

const FIXED_PAYLOAD: SiwsPayload = {
  domain: "com.cstralpt.takumipay",
  address: "7sG9pKmJwTDS2vFJG9L7tS8m5w3VZCgTr3qMEuPH1vLx",
  statement: "Sign in to TakumiPay",
  uri: "takumipay://wallet-auth",
  version: "1",
  chainId: "mainnet",
  nonce: "abc123",
  issuedAt: "2026-04-18T00:00:00.000Z",
  expirationTime: "2026-04-18T00:05:00.000Z",
};

const FIXED_MESSAGE = [
  "com.cstralpt.takumipay wants you to sign in with your Solana account:",
  "7sG9pKmJwTDS2vFJG9L7tS8m5w3VZCgTr3qMEuPH1vLx",
  "",
  "Sign in to TakumiPay",
  "",
  "URI: takumipay://wallet-auth",
  "Version: 1",
  "Chain ID: mainnet",
  "Nonce: abc123",
  "Issued At: 2026-04-18T00:00:00.000Z",
  "Expiration Time: 2026-04-18T00:05:00.000Z",
].join("\n");

const DEVNET_PAYLOAD: SiwsPayload = {
  ...FIXED_PAYLOAD,
  chainId: "devnet",
  address: "9xQnPzNyxwBA6Wq8pLJ1tLuPGLpSzLHHbbNgTzcR9vvX",
};

const RESOURCES_PAYLOAD: SiwsPayload = {
  ...FIXED_PAYLOAD,
  resources: [
    "ipfs://bafy...",
    "https://takumipay.example/terms",
  ],
};

describe("siws-message builder", () => {
  it("emits exactly the canonical mainnet fixture", () => {
    expect(buildSiwsMessage(FIXED_PAYLOAD)).toBe(FIXED_MESSAGE);
  });

  it("round-trips mainnet", () => {
    const msg = buildSiwsMessage(FIXED_PAYLOAD);
    expect(parseSiwsMessage(msg)).toEqual(FIXED_PAYLOAD);
  });

  it("round-trips devnet", () => {
    const msg = buildSiwsMessage(DEVNET_PAYLOAD);
    expect(parseSiwsMessage(msg)).toEqual(DEVNET_PAYLOAD);
  });

  it("round-trips with resources block", () => {
    const msg = buildSiwsMessage(RESOURCES_PAYLOAD);
    expect(parseSiwsMessage(msg)).toEqual(RESOURCES_PAYLOAD);
    expect(msg).toContain("Resources:");
    expect(msg).toContain("- ipfs://bafy...");
  });

  it("emits header exactly", () => {
    const msg = buildSiwsMessage(FIXED_PAYLOAD);
    expect(msg.startsWith("com.cstralpt.takumipay wants you to sign in with your Solana account:\n")).toBe(true);
  });

  it("uses LF, never CRLF", () => {
    const msg = buildSiwsMessage(FIXED_PAYLOAD);
    expect(msg.includes("\r")).toBe(false);
  });

  it("rejects CRLF in the parsed message", () => {
    expect(() => parseSiwsMessage("foo\r\nbar")).toThrow(SiwsFormatError);
  });

  it("rejects expirationTime <= issuedAt (builder)", () => {
    expect(() =>
      buildSiwsMessage({
        ...FIXED_PAYLOAD,
        issuedAt: "2026-04-18T00:05:00.000Z",
        expirationTime: "2026-04-18T00:00:00.000Z",
      }),
    ).toThrow(SiwsFormatError);
  });

  it("rejects expirationTime <= issuedAt (parser)", () => {
    const bad = [
      "com.cstralpt.takumipay wants you to sign in with your Solana account:",
      "7sG9pKmJwTDS2vFJG9L7tS8m5w3VZCgTr3qMEuPH1vLx",
      "",
      "URI: takumipay://wallet-auth",
      "Version: 1",
      "Chain ID: mainnet",
      "Nonce: abc123",
      "Issued At: 2026-04-18T00:05:00.000Z",
      "Expiration Time: 2026-04-18T00:00:00.000Z",
    ].join("\n");
    expect(() => parseSiwsMessage(bad)).toThrow(SiwsFormatError);
  });
});

describe("chainSlugToCluster", () => {
  it.each([
    ["solana-mainnet", "mainnet"],
    ["solana-devnet", "devnet"],
    ["solana-testnet", "testnet"],
  ])("%s → %s", (slug, cluster) => {
    expect(chainSlugToCluster(slug)).toBe(cluster);
  });

  it("throws on unsupported slug", () => {
    expect(() => chainSlugToCluster("ethereum-1")).toThrow(SiwsFormatError);
  });
});
