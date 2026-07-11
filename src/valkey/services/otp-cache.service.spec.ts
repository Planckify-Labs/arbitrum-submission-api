import { ConfigService } from "@nestjs/config";
import { OtpCacheService } from "./otp-cache.service";
import { ValkeyService } from "../valkey.service";

/**
 * In-memory stand-in for Valkey. Tracks the TTL each `set` was written with
 * so the tests can assert that a wrong guess / resend does not extend the
 * challenge window.
 */
class FakeValkey {
  store = new Map<string, { value: unknown; ttl: number }>();

  set(key: string, value: unknown, options?: { ttl?: number }) {
    this.store.set(key, { value, ttl: options?.ttl ?? -1 });
    return Promise.resolve(true);
  }

  get<T>(key: string): Promise<T | null> {
    const hit = this.store.get(key);
    // Valkey round-trips through JSON; mirror that so tests can't pass by
    // sharing an object reference the real service would never hand back.
    return Promise.resolve(
      hit ? (JSON.parse(JSON.stringify(hit.value)) as T) : null,
    );
  }

  del(key: string) {
    this.store.delete(key);
    return Promise.resolve(1);
  }

  ttl(key: string) {
    return Promise.resolve(this.store.get(key)?.ttl ?? -2);
  }

  incr(key: string) {
    const current = (this.store.get(key)?.value as number) ?? 0;
    const next = current + 1;
    this.store.set(key, { value: next, ttl: this.store.get(key)?.ttl ?? -1 });
    return Promise.resolve(next);
  }

  expire(key: string, seconds: number) {
    const hit = this.store.get(key);
    if (hit) hit.ttl = seconds;
    return Promise.resolve(true);
  }
}

describe("OtpCacheService", () => {
  let valkey: FakeValkey;
  let service: OtpCacheService;

  const config = {
    get: (key: string, fallback: string) =>
      key === "OTP_EXPIRE_MINUTES" ? "10" : fallback,
  } as unknown as ConfigService;

  beforeEach(() => {
    valkey = new FakeValkey();
    service = new OtpCacheService(
      valkey as unknown as ValkeyService,
      config,
    );
  });

  it("issues a six-digit code and never stores it in plaintext", async () => {
    const { challengeId, code, expiresInSeconds } =
      await service.createChallenge({
        email: "a@b.com",
        googleId: "g1",
        name: null,
        picture: null,
      });

    expect(code).toMatch(/^\d{6}$/);
    expect(expiresInSeconds).toBe(600);

    const raw = JSON.stringify([...valkey.store.values()]);
    expect(raw).not.toContain(code);

    const stored = await service.getChallenge(challengeId);
    expect(stored?.codeHash).toMatch(/^\$argon2/);
  });

  it("writes the challenge with the configured TTL", async () => {
    const { challengeId } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: null,
      picture: null,
    });

    expect(valkey.store.get(`otp:google:${challengeId}`)?.ttl).toBe(600);
  });

  it("returns the identity on a correct code and destroys the challenge", async () => {
    const { challengeId, code } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: "Ada",
      picture: null,
    });

    const identity = await service.consumeChallenge(challengeId, code);
    expect(identity).toEqual({
      email: "a@b.com",
      googleId: "g1",
      name: "Ada",
      picture: null,
    });

    // Single-use: the same code must not work twice.
    expect(await service.consumeChallenge(challengeId, code)).toBeNull();
  });

  it("rejects a wrong code without extending the expiry", async () => {
    const { challengeId, code } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: null,
      picture: null,
    });

    const wrong = code === "000000" ? "111111" : "000000";

    // Simulate 90s of the window already elapsed.
    valkey.store.get(`otp:google:${challengeId}`)!.ttl = 510;

    expect(await service.consumeChallenge(challengeId, wrong)).toBeNull();

    const after = valkey.store.get(`otp:google:${challengeId}`);
    expect(after?.ttl).toBe(510);
    expect((after?.value as { attempts: number }).attempts).toBe(1);

    // The real code still works while budget remains.
    expect(await service.consumeChallenge(challengeId, code)).not.toBeNull();
  });

  it("destroys the challenge after five wrong codes", async () => {
    const { challengeId, code } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: null,
      picture: null,
    });
    const wrong = code === "000000" ? "111111" : "000000";

    for (let i = 0; i < 5; i++) {
      expect(await service.consumeChallenge(challengeId, wrong)).toBeNull();
    }

    expect(valkey.store.has(`otp:google:${challengeId}`)).toBe(false);
    // Even the correct code is dead now.
    expect(await service.consumeChallenge(challengeId, code)).toBeNull();
  });

  it("rotates the code on resend, preserving the original expiry", async () => {
    const { challengeId, code } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: null,
      picture: null,
    });

    valkey.store.get(`otp:google:${challengeId}`)!.ttl = 400;

    const rotated = await service.rotateCode(challengeId);
    expect(rotated).not.toBeNull();
    expect(rotated!.expiresInSeconds).toBe(400);
    expect(rotated!.email).toBe("a@b.com");
    expect(valkey.store.get(`otp:google:${challengeId}`)?.ttl).toBe(400);

    // Old code is dead, new code works.
    expect(await service.consumeChallenge(challengeId, code)).toBeNull();
  });

  it("gives up after the resend budget is exhausted", async () => {
    const { challengeId } = await service.createChallenge({
      email: "a@b.com",
      googleId: "g1",
      name: null,
      picture: null,
    });

    expect(await service.rotateCode(challengeId)).not.toBeNull();
    expect(await service.rotateCode(challengeId)).not.toBeNull();
    expect(await service.rotateCode(challengeId)).not.toBeNull();
    expect(await service.rotateCode(challengeId)).toBeNull();

    expect(valkey.store.has(`otp:google:${challengeId}`)).toBe(false);
  });

  it("throttles sign-in starts per address and expires the counter", async () => {
    for (let i = 0; i < 6; i++) {
      expect(await service.consumeStartBudget("A@b.com")).toBe(true);
    }
    expect(await service.consumeStartBudget("a@b.com")).toBe(false);

    // The counter must carry a TTL, or the address is locked out forever.
    expect(valkey.store.get("otp:rl:a@b.com")?.ttl).toBe(3600);
  });

  it("returns null for an unknown challenge", async () => {
    expect(await service.consumeChallenge("nope", "000000")).toBeNull();
    expect(await service.rotateCode("nope")).toBeNull();
  });
});
