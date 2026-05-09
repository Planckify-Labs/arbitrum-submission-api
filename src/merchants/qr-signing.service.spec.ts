import { generateKeyPairSync } from "node:crypto";
import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { QrSigningService } from "./qr-signing.service";

function configStub(env: Record<string, string> = {}) {
  return {
    get: jest.fn((k: string) => env[k]),
  } as unknown as ConfigService;
}

describe("QrSigningService.signMerchantQr", () => {
  it("503s when env PEM is missing and no test key was set", async () => {
    const svc = new QrSigningService(configStub());
    await expect(
      svc.signMerchantQr({
        merchantId: "mch_x",
        displayName: "X",
        country: "ID",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("emits 'takumipay:v1:' wire prefix and matching iat on success", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const svc = new QrSigningService(
      configStub({ TAKUMIPAY_QR_KID: "test-kid" }),
    );
    svc.setTestPrivateKey(privateKey);

    const out = await svc.signMerchantQr({
      merchantId: "mch_x",
      displayName: "Toko",
      country: "ID",
    });
    expect(out.wire.startsWith("takumipay:v1:")).toBe(true);
    expect(out.kid).toBe("test-kid");
    expect(typeof out.iat).toBe("number");
  });

  it("includes qrisPan claim only when supplied", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const svc = new QrSigningService(configStub());
    svc.setTestPrivateKey(privateKey);

    const out = await svc.signMerchantQr({
      merchantId: "mch_x",
      displayName: "Toko",
      country: "ID",
      qrisPan: "936000091234567890",
    });
    const [, payloadB64] = out.jws.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    expect(payload.qrisPan).toBe("936000091234567890");
  });

  it("503s with QR_SIGNING_KEY_INVALID for an unparseable PEM env", async () => {
    const svc = new QrSigningService(
      configStub({ TAKUMIPAY_QR_PRIVATE_KEY_PEM: "not a real pem" }),
    );
    await expect(
      svc.signMerchantQr({
        merchantId: "mch_x",
        displayName: "X",
        country: "ID",
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("QrSigningService.verifyAndExtractMerchantId", () => {
  it("rejects payloads without 'takumipay:v1:' prefix", async () => {
    const svc = new QrSigningService(configStub());
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    svc.setTestPrivateKey(privateKey);
    await expect(
      svc.verifyAndExtractMerchantId("nope"),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("round-trips a self-signed JWS", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const svc = new QrSigningService(configStub());
    svc.setTestPrivateKey(privateKey);
    const signed = await svc.signMerchantQr({
      merchantId: "mch_round",
      displayName: "X",
      country: "ID",
    });
    const id = await svc.verifyAndExtractMerchantId(signed.wire);
    expect(id).toBe("mch_round");
  });

  it("rejects a JWS signed by a different keypair (signature invalid)", async () => {
    const { privateKey: keyA } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const { privateKey: keyB } = generateKeyPairSync("ec", { namedCurve: "P-256" });

    const signer = new QrSigningService(configStub());
    signer.setTestPrivateKey(keyA);
    const signed = await signer.signMerchantQr({
      merchantId: "mch_a",
      displayName: "A",
      country: "ID",
    });

    const verifier = new QrSigningService(configStub());
    verifier.setTestPrivateKey(keyB);
    await expect(
      verifier.verifyAndExtractMerchantId(signed.wire),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
