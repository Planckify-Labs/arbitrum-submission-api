import { createSign, generateKeyPairSync } from "node:crypto";
import type { ConfigService } from "@nestjs/config";
import {
  isAllowedCertificateUrl,
  ZerionWebhookSignatureService,
} from "./zerion-webhook-signature.service";

const CERT_URL = "https://webhooks.zerion.io/certificate.pem";

function keypair() {
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });
  return {
    publicPem: publicKey.export({ type: "spki", format: "pem" }) as string,
    privateKey,
  };
}

function sign(
  privateKey: ReturnType<typeof keypair>["privateKey"],
  timestamp: string,
  body: Buffer,
) {
  const signer = createSign("RSA-SHA256");
  signer.update(
    Buffer.concat([Buffer.from(`${timestamp}\n`), body, Buffer.from("\n")]),
  );
  return signer.sign(privateKey, "base64");
}

function harness(pems: string[]) {
  let calls = 0;
  const fetchMock = jest.fn(async () => {
    const pem = pems[Math.min(calls, pems.length - 1)];
    calls += 1;
    return { ok: true, status: 200, text: async () => pem };
  });
  (globalThis as { fetch: unknown }).fetch = fetchMock;
  const config = { get: jest.fn(() => undefined) };
  const service = new ZerionWebhookSignatureService(
    config as unknown as ConfigService,
  );
  return { service, fetchMock };
}

describe("ZerionWebhookSignatureService", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it("accepts a valid RSA-SHA256 signature over `timestamp\\nbody\\n` and caches the certificate", async () => {
    const { publicPem, privateKey } = keypair();
    const { service, fetchMock } = harness([publicPem]);
    const body = Buffer.from('{"data":{"id":"n1"},"included":[]}');
    const timestamp = new Date().toISOString();
    const signature = sign(privateKey, timestamp, body);

    const args = {
      timestamp,
      signatureB64: signature,
      certificateUrl: CERT_URL,
      rawBody: body,
    };
    await expect(service.verify(args)).resolves.toEqual({ ok: true });
    await expect(service.verify(args)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once on a miss (certificate rotation), then rejects", async () => {
    const old = keypair();
    const fresh = keypair();
    const { service, fetchMock } = harness([old.publicPem, fresh.publicPem]);
    const body = Buffer.from("{}");
    const timestamp = new Date().toISOString();

    // Signed with the NEW key while we still hold the OLD certificate.
    await expect(
      service.verify({
        timestamp,
        signatureB64: sign(fresh.privateKey, timestamp, body),
        certificateUrl: CERT_URL,
        rawBody: body,
      }),
    ).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // A third key never matches either fetch → bad_signature.
    const rogue = keypair();
    await expect(
      service.verify({
        timestamp,
        signatureB64: sign(rogue.privateKey, timestamp, body),
        certificateUrl: CERT_URL,
        rawBody: body,
      }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });
  });

  it("a tampered body, a stale timestamp, or missing headers fail closed", async () => {
    const { publicPem, privateKey } = keypair();
    const { service } = harness([publicPem]);
    const body = Buffer.from('{"a":1}');
    const timestamp = new Date().toISOString();
    const signature = sign(privateKey, timestamp, body);

    await expect(
      service.verify({
        timestamp,
        signatureB64: signature,
        certificateUrl: CERT_URL,
        rawBody: Buffer.from('{"a":2}'),
      }),
    ).resolves.toEqual({ ok: false, reason: "bad_signature" });

    const stale = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    await expect(
      service.verify({
        timestamp: stale,
        signatureB64: sign(privateKey, stale, body),
        certificateUrl: CERT_URL,
        rawBody: body,
      }),
    ).resolves.toEqual({ ok: false, reason: "stale_timestamp" });

    await expect(
      service.verify({
        timestamp,
        signatureB64: undefined,
        certificateUrl: CERT_URL,
        rawBody: body,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_headers" });
    await expect(
      service.verify({
        timestamp,
        signatureB64: signature,
        certificateUrl: CERT_URL,
        rawBody: undefined,
      }),
    ).resolves.toEqual({ ok: false, reason: "missing_raw_body" });
  });

  it("never fetches a certificate from a host that is not Zerion's", async () => {
    const { publicPem, privateKey } = keypair();
    const { service, fetchMock } = harness([publicPem]);
    const body = Buffer.from("{}");
    const timestamp = new Date().toISOString();
    await expect(
      service.verify({
        timestamp,
        signatureB64: sign(privateKey, timestamp, body),
        certificateUrl: "https://evil.example.com/zerion.io/cert.pem",
        rawBody: body,
      }),
    ).resolves.toEqual({ ok: false, reason: "certificate_host_not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("isAllowedCertificateUrl pins https + zerion.io", () => {
    expect(isAllowedCertificateUrl("https://zerion.io/c.pem")).toBe(true);
    expect(isAllowedCertificateUrl("https://api.zerion.io/c.pem")).toBe(true);
    expect(isAllowedCertificateUrl("http://api.zerion.io/c.pem")).toBe(false);
    expect(isAllowedCertificateUrl("https://notzerion.io/c.pem")).toBe(false);
    expect(isAllowedCertificateUrl("https://zerion.io.evil.com/c.pem")).toBe(
      false,
    );
    expect(isAllowedCertificateUrl("garbage")).toBe(false);
  });

  it("can be switched off for local testing", () => {
    const config = {
      get: jest.fn((k: string) =>
        k === "ZERION_WEBHOOK_VALIDATE_SIGNATURES" ? "false" : undefined,
      ),
    };
    const service = new ZerionWebhookSignatureService(
      config as unknown as ConfigService,
    );
    expect(service.enabled).toBe(false);
  });
});
