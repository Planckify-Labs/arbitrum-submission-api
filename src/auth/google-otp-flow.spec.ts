import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AuthService } from "./auth.service";
import { EmailService } from "../email/email.service";
import { NonceCacheService } from "../valkey/services/nonce-cache.service";
import { OtpCacheService } from "../valkey/services/otp-cache.service";
import { PrismaService } from "../prisma/prisma.service";
import { SiwsService } from "./siws/siws.service";
import { SiwsSuiService } from "./siws-sui/siws-sui.service";

/**
 * Guards the two-step contract: `startGoogleLogin` must never mint a session,
 * and `verifyGoogleOtp` must never mint one without a valid code.
 */
describe("Google two-step OTP sign-in", () => {
  const GOOGLE_PAYLOAD = {
    email: "Ada@Example.com",
    email_verified: true,
    sub: "google-sub-1",
    name: "Ada",
    picture: "https://pic",
  };

  let prisma: {
    user: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    walletAccountLink: {
      count: jest.Mock;
      upsert: jest.Mock;
    };
  };
  let otpCache: jest.Mocked<Partial<OtpCacheService>>;
  let email: jest.Mocked<Partial<EmailService>>;
  let service: AuthService;

  const config = {
    get: (key: string, fallback?: unknown) => fallback,
  } as unknown as ConfigService;

  const jwt = { sign: jest.fn(() => "signed.jwt") } as unknown as JwtService;

  const stubGoogleToken = (payload: unknown) => {
    (service as unknown as { googleClient: unknown }).googleClient = {
      verifyIdToken: jest.fn().mockResolvedValue({
        getPayload: () => payload,
      }),
    };
  };

  beforeEach(() => {
    jest.clearAllMocks();

    prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn(),
        update: jest.fn(),
      },
      walletAccountLink: {
        count: jest.fn().mockResolvedValue(0),
        upsert: jest.fn(),
      },
    };

    otpCache = {
      consumeStartBudget: jest.fn().mockResolvedValue(true),
      createChallenge: jest.fn().mockResolvedValue({
        challengeId: "chal-1",
        code: "483920",
        expiresInSeconds: 600,
      }),
      consumeChallenge: jest.fn(),
      rotateCode: jest.fn(),
      deleteChallenge: jest.fn(),
    };
    Object.defineProperty(otpCache, "expiresInMinutes", { value: 10 });

    email = { sendOtpEmail: jest.fn().mockResolvedValue(true) };

    service = new AuthService(
      prisma as unknown as PrismaService,
      jwt,
      config,
      {} as NonceCacheService,
      otpCache as OtpCacheService,
      email as EmailService,
      {} as SiwsService,
      {} as SiwsSuiService,
    );
  });

  describe("startGoogleLogin", () => {
    it("emails a code and returns a challenge without issuing any token", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);

      const result = await service.startGoogleLogin("id-token", "ios");

      expect(result).toEqual({
        challengeId: "chal-1",
        emailMasked: "a***a@example.com",
        expiresInSeconds: 600,
      });

      // The whole point of the design: no session before the code.
      expect(result).not.toHaveProperty("access_token");
      expect(result).not.toHaveProperty("refresh_token");
      expect(jwt.sign).not.toHaveBeenCalled();

      // No user row exists until the code is accepted.
      expect(prisma.user.create).not.toHaveBeenCalled();

      expect(email.sendOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "ada@example.com",
          code: "483920",
          expiresInMinutes: 10,
        }),
      );
    });

    it("never leaks the code back to the caller", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);
      const result = await service.startGoogleLogin("id-token");
      expect(JSON.stringify(result)).not.toContain("483920");
    });

    it("rejects a Google account whose email is unverified", async () => {
      stubGoogleToken({ ...GOOGLE_PAYLOAD, email_verified: false });

      await expect(service.startGoogleLogin("id-token")).rejects.toThrow(
        BadRequestException,
      );
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it("rejects an unverifiable token", async () => {
      (service as unknown as { googleClient: unknown }).googleClient = {
        verifyIdToken: jest.fn().mockRejectedValue(new Error("bad signature")),
      };

      await expect(service.startGoogleLogin("id-token")).rejects.toThrow(
        BadRequestException,
      );
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it("refuses when the email belongs to a non-Google account, before sending", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        authProvider: "WALLET",
        status: "ACTIVE",
      });

      await expect(service.startGoogleLogin("id-token")).rejects.toThrow(
        BadRequestException,
      );
      // An email that can never complete a sign-in must not be spent.
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
      expect(otpCache.createChallenge).not.toHaveBeenCalled();
    });

    it("refuses an inactive account with 403, before sending", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);
      prisma.user.findUnique.mockResolvedValue({
        id: "u1",
        authProvider: "GOOGLE",
        status: "SUSPENDED",
      });

      await expect(service.startGoogleLogin("id-token")).rejects.toThrow(
        ForbiddenException,
      );
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it("throttles once the per-address budget is spent", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);
      (otpCache.consumeStartBudget as jest.Mock).mockResolvedValue(false);

      await expect(service.startGoogleLogin("id-token")).rejects.toMatchObject({
        status: 429,
      });
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });

    it("drops the challenge when the email cannot be delivered", async () => {
      stubGoogleToken(GOOGLE_PAYLOAD);
      (email.sendOtpEmail as jest.Mock).mockResolvedValue(false);

      await expect(service.startGoogleLogin("id-token")).rejects.toMatchObject({
        status: 503,
      });
      // Otherwise the user waits on a code that will never arrive.
      expect(otpCache.deleteChallenge).toHaveBeenCalledWith("chal-1");
    });
  });

  describe("verifyGoogleOtp", () => {
    it("issues tokens and creates the user once the code is accepted", async () => {
      (otpCache.consumeChallenge as jest.Mock).mockResolvedValue({
        email: "ada@example.com",
        googleId: "google-sub-1",
        name: "Ada",
        picture: null,
      });
      prisma.user.create.mockResolvedValue({
        id: "u1",
        email: "ada@example.com",
        name: "Ada",
        role: "USER",
        status: "ACTIVE",
      });

      const result = await service.verifyGoogleOtp("chal-1", "483920");

      expect(prisma.user.create).toHaveBeenCalled();
      expect(result.access_token).toBe("signed.jwt");
      expect(result.refresh_token).toBe("signed.jwt");
      expect(result.user).toMatchObject({ id: "u1", email: "ada@example.com" });
    });

    it("reports hasWallet=false for an account with no linked wallets", async () => {
      (otpCache.consumeChallenge as jest.Mock).mockResolvedValue({
        email: "ada@example.com",
        googleId: "google-sub-1",
        name: "Ada",
        picture: null,
      });
      prisma.user.create.mockResolvedValue({
        id: "u1",
        email: "ada@example.com",
        role: "USER",
        status: "ACTIVE",
      });
      prisma.walletAccountLink.count.mockResolvedValue(0);

      const result = await service.verifyGoogleOtp("chal-1", "483920");
      expect(result.hasWallet).toBe(false);
    });

    it("reports hasWallet=true for a returning account with a linked wallet", async () => {
      (otpCache.consumeChallenge as jest.Mock).mockResolvedValue({
        email: "ada@example.com",
        googleId: "google-sub-1",
        name: "Ada",
        picture: null,
      });
      prisma.user.findFirst.mockResolvedValue({
        id: "u1",
        email: "ada@example.com",
        role: "USER",
        status: "ACTIVE",
      });
      prisma.walletAccountLink.count.mockResolvedValue(2);

      const result = await service.verifyGoogleOtp("chal-1", "483920");
      expect(result.hasWallet).toBe(true);
      expect(prisma.walletAccountLink.count).toHaveBeenCalledWith({
        where: { userId: "u1" },
      });
    });

    it("issues nothing on a rejected code", async () => {
      (otpCache.consumeChallenge as jest.Mock).mockResolvedValue(null);

      await expect(service.verifyGoogleOtp("chal-1", "000000")).rejects.toThrow(
        BadRequestException,
      );
      expect(jwt.sign).not.toHaveBeenCalled();
      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it("answers 400, never 401 — a 401 would wipe the caller's wallet session", async () => {
      (otpCache.consumeChallenge as jest.Mock).mockResolvedValue(null);

      await expect(
        service.verifyGoogleOtp("chal-1", "000000"),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe("resendGoogleOtp", () => {
    it("re-sends without extending the original expiry", async () => {
      (otpCache.rotateCode as jest.Mock).mockResolvedValue({
        code: "111222",
        resends: 1,
        email: "ada@example.com",
        expiresInSeconds: 412,
      });

      const result = await service.resendGoogleOtp("chal-1");

      expect(result.expiresInSeconds).toBe(412);
      expect(result.emailMasked).toBe("a***a@example.com");
      expect(email.sendOtpEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "111222",
          // Distinct per send, or Resend's 24h idempotency window swallows it.
          idempotencySuffix: "chal-1/1",
        }),
      );
    });

    it("rejects a dead challenge", async () => {
      (otpCache.rotateCode as jest.Mock).mockResolvedValue(null);
      await expect(service.resendGoogleOtp("chal-1")).rejects.toThrow(
        BadRequestException,
      );
      expect(email.sendOtpEmail).not.toHaveBeenCalled();
    });
  });

  describe("linkWallet", () => {
    it("upserts an idempotent link keyed on (userId, walletAddress)", async () => {
      await service.linkWallet("u1", "0xAbc123");

      expect(prisma.walletAccountLink.upsert).toHaveBeenCalledWith({
        where: {
          userId_walletAddress: { userId: "u1", walletAddress: "0xAbc123" },
        },
        create: { userId: "u1", walletAddress: "0xAbc123" },
        update: {},
      });
    });

    it("trims the address before storing it", async () => {
      await service.linkWallet("u1", "  0xAbc123  ");
      expect(prisma.walletAccountLink.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: { userId: "u1", walletAddress: "0xAbc123" },
        }),
      );
    });

    it("rejects an empty address", async () => {
      await expect(service.linkWallet("u1", "   ")).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.walletAccountLink.upsert).not.toHaveBeenCalled();
    });
  });
});
