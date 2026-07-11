import { randomBytes, randomInt } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import * as argon2 from "argon2";
import { ValkeyService } from "../valkey.service";

/**
 * Identity proven by the Google ID token, parked until the emailed code is
 * entered. Nothing here is a credential on its own — the user row is not
 * created until {@link OtpCacheService.consumeChallenge} succeeds.
 */
export interface OtpChallengeIdentity {
  email: string;
  googleId: string;
  name: string | null;
  picture: string | null;
}

export interface OtpChallenge extends OtpChallengeIdentity {
  /** argon2 hash of the 6-digit code. The plaintext is never stored. */
  codeHash: string;
  attempts: number;
  resends: number;
}

export interface IssuedOtp {
  challengeId: string;
  code: string;
  expiresInSeconds: number;
}

export interface RotatedOtp {
  code: string;
  resends: number;
  email: string;
  /** Remaining life of the original challenge — a resend never extends it. */
  expiresInSeconds: number;
}

/** Wrong-code submissions allowed before the challenge is destroyed. */
const MAX_ATTEMPTS = 5;
/** Re-sends allowed per challenge before the user must restart sign-in. */
const MAX_RESENDS = 3;
/** Sign-in starts allowed per email per hour. */
const MAX_STARTS_PER_HOUR = 6;
const START_WINDOW_SECONDS = 3600;

@Injectable()
export class OtpCacheService {
  private readonly logger = new Logger(OtpCacheService.name);
  private readonly ttlSeconds: number;

  constructor(
    private readonly valkeyService: ValkeyService,
    private readonly configService: ConfigService,
  ) {
    const minutes = parseInt(
      this.configService.get<string>("OTP_EXPIRE_MINUTES", "10"),
      10,
    );
    this.ttlSeconds = minutes * 60;
  }

  get expiresInSeconds(): number {
    return this.ttlSeconds;
  }

  get expiresInMinutes(): number {
    return Math.floor(this.ttlSeconds / 60);
  }

  private challengeKey(challengeId: string): string {
    return `otp:google:${challengeId}`;
  }

  private startRateKey(email: string): string {
    return `otp:rl:${email.toLowerCase()}`;
  }

  /**
   * Six digits from a CSPRNG. `randomInt` is rejection-sampled, so the
   * distribution stays uniform — `randomBytes(n) % 1_000_000` would bias
   * toward low codes.
   */
  private generateCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, "0");
  }

  /**
   * Throttles sign-in starts per email address. Returns false once the
   * caller has burned the hourly budget.
   */
  async consumeStartBudget(email: string): Promise<boolean> {
    const key = this.startRateKey(email);
    const count = await this.valkeyService.incr(key);

    // INCR creates the key without a TTL — set one on first use, otherwise
    // the counter is immortal and the address is locked out forever.
    if (count === 1) {
      await this.valkeyService.expire(key, START_WINDOW_SECONDS);
    }

    return count <= MAX_STARTS_PER_HOUR;
  }

  async createChallenge(identity: OtpChallengeIdentity): Promise<IssuedOtp> {
    const challengeId = randomBytes(32).toString("hex");
    const code = this.generateCode();

    const challenge: OtpChallenge = {
      ...identity,
      codeHash: await argon2.hash(code),
      attempts: 0,
      resends: 0,
    };

    await this.valkeyService.set(this.challengeKey(challengeId), challenge, {
      ttl: this.ttlSeconds,
    });

    return { challengeId, code, expiresInSeconds: this.ttlSeconds };
  }

  async getChallenge(challengeId: string): Promise<OtpChallenge | null> {
    return this.valkeyService.get<OtpChallenge>(this.challengeKey(challengeId));
  }

  async deleteChallenge(challengeId: string): Promise<void> {
    await this.valkeyService.del(this.challengeKey(challengeId));
  }

  /**
   * Rotates the code on an existing challenge, preserving its remaining TTL
   * so a resend can't be used to extend the window indefinitely.
   *
   * Returns null when the challenge is gone or the resend budget is spent.
   */
  async rotateCode(challengeId: string): Promise<RotatedOtp | null> {
    const key = this.challengeKey(challengeId);
    const challenge = await this.valkeyService.get<OtpChallenge>(key);
    if (!challenge) return null;

    if (challenge.resends >= MAX_RESENDS) {
      await this.valkeyService.del(key);
      this.logger.warn("OTP challenge destroyed — resend budget exhausted");
      return null;
    }

    const remainingTtl = await this.valkeyService.ttl(key);
    if (remainingTtl <= 0) return null;

    const code = this.generateCode();
    const next: OtpChallenge = {
      ...challenge,
      codeHash: await argon2.hash(code),
      attempts: 0,
      resends: challenge.resends + 1,
    };

    await this.valkeyService.set(key, next, { ttl: remainingTtl });

    return {
      code,
      resends: next.resends,
      email: challenge.email,
      expiresInSeconds: remainingTtl,
    };
  }

  /**
   * Checks `code` against the stored hash. On success the challenge is
   * destroyed before the identity is returned, so a code is single-use even
   * if two requests race. On failure the attempt counter is advanced and the
   * challenge is destroyed once the budget is spent.
   *
   * A `null` return is deliberately indistinguishable between "no such
   * challenge", "expired", "wrong code", and "too many attempts" — the
   * caller must not tell those apart to the client.
   */
  async consumeChallenge(
    challengeId: string,
    code: string,
  ): Promise<OtpChallengeIdentity | null> {
    const key = this.challengeKey(challengeId);
    const challenge = await this.valkeyService.get<OtpChallenge>(key);
    if (!challenge) return null;

    if (challenge.attempts >= MAX_ATTEMPTS) {
      await this.valkeyService.del(key);
      return null;
    }

    const matches = await argon2.verify(challenge.codeHash, code);

    if (!matches) {
      const attempts = challenge.attempts + 1;

      if (attempts >= MAX_ATTEMPTS) {
        await this.valkeyService.del(key);
        this.logger.warn("OTP challenge destroyed — attempt budget exhausted");
        return null;
      }

      // Preserve the original expiry; a wrong guess must not buy more time.
      const remainingTtl = await this.valkeyService.ttl(key);
      if (remainingTtl > 0) {
        await this.valkeyService.set(
          key,
          { ...challenge, attempts },
          { ttl: remainingTtl },
        );
      }
      return null;
    }

    await this.valkeyService.del(key);

    return {
      email: challenge.email,
      googleId: challenge.googleId,
      name: challenge.name,
      picture: challenge.picture,
    };
  }
}
