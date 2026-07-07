import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { NonceCacheService } from "../valkey/services/nonce-cache.service";
import { SiwsService } from "./siws/siws.service";
import { SiwsSuiService } from "./siws-sui/siws-sui.service";
import { SiwsStellarService } from "./siws-stellar/siws-stellar.service";
import { PrismaService } from "../prisma/prisma.service";

describe("AuthService.verifySignature dispatcher", () => {
  const nonceCache = {
    getNonce: jest.fn(),
    deleteNonce: jest.fn(),
  } as unknown as NonceCacheService;

  const prisma = {} as PrismaService;
  const jwt = {} as JwtService;
  const config = {
    get: (key: string) =>
      key === "SIWE_DOMAIN" ? "com.cstralpt.takumipay" : undefined,
  } as ConfigService;

  const siws = {
    verify: jest.fn(),
    buildMessage: jest.fn(),
  } as unknown as SiwsService;

  const siwsSui = {
    verify: jest.fn(),
    buildMessage: jest.fn(),
  } as unknown as SiwsSuiService;

  const siwsStellar = {
    verify: jest.fn(),
    buildMessage: jest.fn(),
  } as unknown as SiwsStellarService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma,
      jwt,
      config,
      nonceCache,
      siws,
      siwsSui,
      siwsStellar,
    );
  });

  it("routes SIWS messages to SiwsService.verify", async () => {
    (siws.verify as jest.Mock).mockResolvedValue({
      success: true,
      address: "ABCsolana",
      domain: "com.cstralpt.takumipay",
      nonce: "n",
      chainId: "devnet",
    });

    const message =
      "com.cstralpt.takumipay wants you to sign in with your Solana account:\nABCsolana";
    const res = await service.verifySignature(message, "some-sig");

    expect(siws.verify).toHaveBeenCalledWith(message, "some-sig");
    expect(res).toEqual({
      success: true,
      address: "ABCsolana",
      namespace: "solana",
    });
  });

  it("returns failure for garbage messages without invoking either verifier", async () => {
    const res = await service.verifySignature("not a real siwe/siws", "sig");
    expect(siws.verify).not.toHaveBeenCalled();
    expect(res.success).toBe(false);
  });

  it("returns failure when SiwsService returns failure", async () => {
    (siws.verify as jest.Mock).mockResolvedValue({
      success: false,
      address: "",
      domain: "",
      nonce: "",
      chainId: "",
    });

    const message =
      "com.cstralpt.takumipay wants you to sign in with your Solana account:\nABCsolana";
    const res = await service.verifySignature(message, "bad-sig");
    expect(res.success).toBe(false);
    expect(res.namespace).toBe("eip155");
  });

  it("routes SIWS-Stellar messages to SiwsStellarService.verify", async () => {
    (siwsStellar.verify as jest.Mock).mockResolvedValue({
      success: true,
      address: "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
      domain: "com.cstralpt.takumipay",
      nonce: "n",
      chainId: "mainnet",
    });

    const message =
      "com.cstralpt.takumipay wants you to sign in with your Stellar account:\nGDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";
    const res = await service.verifySignature(message, "some-sig");

    expect(siwsStellar.verify).toHaveBeenCalledWith(message, "some-sig");
    expect(res).toEqual({
      success: true,
      address: "GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6",
      namespace: "stellar",
    });
  });

  it("returns failure when SiwsStellarService returns failure", async () => {
    (siwsStellar.verify as jest.Mock).mockResolvedValue({
      success: false,
      address: "",
      domain: "",
      nonce: "",
      chainId: "",
    });

    const message =
      "com.cstralpt.takumipay wants you to sign in with your Stellar account:\nGDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6";
    const res = await service.verifySignature(message, "bad-sig");
    expect(res.success).toBe(false);
    expect(res.namespace).toBe("eip155");
  });
});
