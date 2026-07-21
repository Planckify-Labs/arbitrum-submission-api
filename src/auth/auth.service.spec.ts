import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { AuthService } from "./auth.service";
import { EmailService } from "../email/email.service";
import { NonceCacheService } from "../valkey/services/nonce-cache.service";
import { OtpCacheService } from "../valkey/services/otp-cache.service";
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

  const otpCache = {
    consumeStartBudget: jest.fn(),
    createChallenge: jest.fn(),
    consumeChallenge: jest.fn(),
    rotateCode: jest.fn(),
    deleteChallenge: jest.fn(),
  } as unknown as OtpCacheService;

  const email = {
    sendOtpEmail: jest.fn(),
  } as unknown as EmailService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(
      prisma,
      jwt,
      config,
      nonceCache,
      otpCache,
      email,
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

  it("verifies an EVM SIWE signature via the offline EOA path", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = "abc12345";
    const message = createSiweMessage({
      domain: "com.cstralpt.takumipay",
      address: account.address,
      uri: "https://takumipay.xyz",
      version: "1",
      chainId: 1,
      nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 60_000),
    });
    const signature = await account.signMessage({ message });
    (nonceCache.getNonce as jest.Mock).mockResolvedValue({
      nonce,
      expires: Date.now() + 60_000,
    });

    const res = await service.verifySignature(message, signature);
    expect(res).toEqual({
      success: true,
      address: account.address,
      namespace: "eip155",
    });
    expect(nonceCache.deleteNonce).toHaveBeenCalledWith(
      "eip155",
      account.address,
    );
  });

  it("rejects an EVM SIWE signature from the wrong signer", async () => {
    const signer = privateKeyToAccount(generatePrivateKey());
    const other = privateKeyToAccount(generatePrivateKey());
    const nonce = "abc12345";
    // Message claims `other` but is signed by `signer`.
    const message = createSiweMessage({
      domain: "com.cstralpt.takumipay",
      address: other.address,
      uri: "https://takumipay.xyz",
      version: "1",
      chainId: 1,
      nonce,
      issuedAt: new Date(),
      expirationTime: new Date(Date.now() + 60_000),
    });
    const signature = await signer.signMessage({ message });
    (nonceCache.getNonce as jest.Mock).mockResolvedValue({
      nonce,
      expires: Date.now() + 60_000,
    });

    const res = await service.verifySignature(message, signature);
    expect(res.success).toBe(false);
    expect(nonceCache.deleteNonce).not.toHaveBeenCalled();
  });

  it("rejects an expired EVM SIWE message", async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const nonce = "abc12345";
    const message = createSiweMessage({
      domain: "com.cstralpt.takumipay",
      address: account.address,
      uri: "https://takumipay.xyz",
      version: "1",
      chainId: 1,
      nonce,
      issuedAt: new Date(Date.now() - 120_000),
      expirationTime: new Date(Date.now() - 60_000),
    });
    const signature = await account.signMessage({ message });
    (nonceCache.getNonce as jest.Mock).mockResolvedValue({
      nonce,
      expires: Date.now() + 60_000,
    });

    const res = await service.verifySignature(message, signature);
    expect(res.success).toBe(false);
  });
});
