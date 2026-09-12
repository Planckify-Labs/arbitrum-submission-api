import { ConfigService } from "@nestjs/config";
import * as nacl from "tweetnacl";
import { RelaySignatureService, isFresh } from "./relay-signature.service";
import {
  WalletConnectPushService,
  notificationCopy,
} from "./walletconnect-push.service";

// expo-server-sdk ships ESM; the push service under test never sends here.
jest.mock("expo-server-sdk", () => ({ Expo: class {} }));

function svc(env: Record<string, string> = {}): RelaySignatureService {
  const config = { get: (k: string) => env[k] } as unknown as ConfigService;
  return new RelaySignatureService(config);
}

function sign(secret: Uint8Array, timestamp: string, body: Buffer): string {
  const msg = Buffer.concat([
    Buffer.from(`${timestamp}.${body.length}.`, "utf8"),
    body,
  ]);
  return Buffer.from(nacl.sign.detached(new Uint8Array(msg), secret)).toString(
    "hex",
  );
}

describe("RelaySignatureService", () => {
  const pair = nacl.sign.keyPair();
  const pubHex = Buffer.from(pair.publicKey).toString("hex");
  const now = 1_800_000_000_000;
  const ts = String(Math.floor(now / 1000));
  const body = Buffer.from(
    JSON.stringify({
      topic: "a".repeat(64),
      tag: 1108,
      message: "ciphertext ünïcode",
    }),
    "utf8",
  );

  it("accepts a signature over `{timestamp}.{byte length}.{body}` from the relay key", async () => {
    const s = svc({ WALLETCONNECT_RELAY_PUBLIC_KEY: pubHex });
    const v = await s.verify({
      signatureHex: sign(pair.secretKey, ts, body),
      timestamp: ts,
      rawBody: body,
      now,
    });
    expect(v).toEqual({ ok: true });
  });

  it("rejects a wrong key, a tampered body, a tampered timestamp, and missing pieces", async () => {
    const s = svc({ WALLETCONNECT_RELAY_PUBLIC_KEY: pubHex });
    const other = nacl.sign.keyPair();
    const good = sign(pair.secretKey, ts, body);
    const cases: Array<
      [Parameters<RelaySignatureService["verify"]>[0], string]
    > = [
      [
        {
          signatureHex: sign(other.secretKey, ts, body),
          timestamp: ts,
          rawBody: body,
          now,
        },
        "bad_signature",
      ],
      [
        {
          signatureHex: good,
          timestamp: ts,
          rawBody: Buffer.from(`${body.toString()} `),
          now,
        },
        "bad_signature",
      ],
      [
        {
          signatureHex: good,
          timestamp: String(Number(ts) + 1),
          rawBody: body,
          now,
        },
        "bad_signature",
      ],
      [
        { signatureHex: undefined, timestamp: ts, rawBody: body, now },
        "missing_headers",
      ],
      [
        { signatureHex: good, timestamp: undefined, rawBody: body, now },
        "missing_headers",
      ],
      [
        { signatureHex: good, timestamp: ts, rawBody: undefined, now },
        "missing_raw_body",
      ],
      [
        { signatureHex: "zz", timestamp: ts, rawBody: body, now },
        "bad_signature_encoding",
      ],
      [
        { signatureHex: "abcd", timestamp: ts, rawBody: body, now },
        "bad_signature_length",
      ],
    ];
    for (const [input, reason] of cases) {
      const v = await s.verify(input);
      expect(v).toEqual({ ok: false, reason });
    }
  });

  it("refuses a stale or future timestamp (seconds or milliseconds)", async () => {
    const s = svc({ WALLETCONNECT_RELAY_PUBLIC_KEY: pubHex });
    const old = String(Math.floor(now / 1000) - 3600);
    const v = await s.verify({
      signatureHex: sign(pair.secretKey, old, body),
      timestamp: old,
      rawBody: body,
      now,
    });
    expect(v).toEqual({ ok: false, reason: "stale_timestamp" });
    expect(isFresh(String(now), now)).toBe(true);
    expect(isFresh(String(Math.floor(now / 1000) + 60), now)).toBe(true);
    expect(isFresh(String(now + 20 * 60 * 1000), now)).toBe(false);
    expect(isFresh("not-a-number", now)).toBe(false);
  });

  it("signature validation can be disabled explicitly only", () => {
    expect(svc({}).enabled).toBe(true);
    expect(
      svc({ WALLETCONNECT_PUSH_VALIDATE_SIGNATURES: "false" }).enabled,
    ).toBe(false);
  });
});

describe("notificationCopy", () => {
  it("notifies for proposals, authenticate and requests; stays silent otherwise", () => {
    expect(notificationCopy(1100)?.title).toBe("Connection request");
    expect(notificationCopy(1116)?.title).toBe("Connection request");
    expect(notificationCopy(1108)?.title).toBe("Approval needed");
    expect(notificationCopy(1112)).toBeNull();
    expect(notificationCopy(undefined)).toBeNull();
  });
});

describe("WalletConnectPushService.deliver", () => {
  function harness(opts: { client?: { token: string } | null } = {}) {
    const sent: Array<{ tokens: string[]; title: string }> = [];
    const prisma = {
      walletConnectPushClient: {
        findUnique: () =>
          Promise.resolve(
            opts.client === undefined
              ? { token: "ExponentPushToken[abc]" }
              : opts.client,
          ),
      },
    };
    const push = {
      sendToTokens: (tokens: string[], args: { title: string }) => {
        sent.push({ tokens, title: args.title });
        return Promise.resolve({
          attempted: tokens.length,
          accepted: tokens.length,
          pruned: 0,
        });
      },
    };
    const service = new WalletConnectPushService(
      prisma as never,
      push as never,
    );
    return { service, sent };
  }

  it("notifies the registered device for a session request and dedupes retries", async () => {
    const { service, sent } = harness();
    const msg = { id: "m1", topic: "t", tag: 1108, message: "enc" };
    expect(await service.deliver("client-1", msg)).toEqual({ delivered: true });
    expect(await service.deliver("client-1", msg)).toEqual({ delivered: true });
    expect(sent).toEqual([
      { tokens: ["ExponentPushToken[abc]"], title: "Approval needed" },
    ]);
  });

  it("ignores tags that need no human and unknown clients", async () => {
    const { service, sent } = harness();
    expect(await service.deliver("client-1", { id: "m2", tag: 1112 })).toEqual({
      delivered: false,
      reason: "ignored_tag",
    });
    const unknown = harness({ client: null });
    expect(
      await unknown.service.deliver("nobody", { id: "m3", tag: 1100 }),
    ).toEqual({
      delivered: false,
      reason: "unknown_client",
    });
    expect(sent).toEqual([]);
  });
});
