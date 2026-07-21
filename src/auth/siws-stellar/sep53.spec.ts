import { hash, Keypair } from "@stellar/stellar-base";
import { sep53Digest, SEP53_PREFIX } from "./sep53";

/**
 * SEP-53 framing. Byte-for-byte mirror of
 * `mobile-app/services/chains/stellar/sep53.test.ts` — these vectors are
 * the mobile↔server interop contract for auth signatures.
 */
describe("sep53Digest", () => {
  it("produces a 32-byte SHA-256 digest", () => {
    expect(sep53Digest("anything").length).toBe(32);
  });

  it("applies the domain-separation prefix (differs from raw-message hash)", () => {
    expect(SEP53_PREFIX).toBe("Stellar Signed Message:\n");
    const framed = sep53Digest("Hello, World!");
    const bare = hash(Buffer.from("Hello, World!", "utf8"));
    expect(Buffer.from(framed).equals(Buffer.from(bare))).toBe(false);
  });

  it("verifies the official SEP-53 ASCII test vector", () => {
    // https://stellar.org/protocol/sep-53 — account signs "Hello, World!"
    const pub = "GBXFXNDLV4LSWA4VB7YIL5GBD7BVNR22SGBTDKMO2SBZZHDXSKZYCP7L";
    const sig = Buffer.from(
      "fO5dbYhXUhBMhe6kId/cuVq/AfEnHRHEvsP8vXh03M1uLpi5e46yO2Q8rEBzu3feXQewcQE5GArp88u6ePK6BA==",
      "base64",
    );
    const kp = Keypair.fromPublicKey(pub);
    expect(kp.verify(sep53Digest("Hello, World!"), sig)).toBe(true);
  });

  it("round-trips a signature and rejects the pre-SEP-53 raw-UTF-8 form", () => {
    const kp = Keypair.random();
    const message = "takumipay.xyz wants you to sign in — nonce:abc123";

    const sep53Sig = kp.sign(sep53Digest(message));
    expect(kp.verify(sep53Digest(message), sep53Sig)).toBe(true);

    // A raw-UTF-8 signature is a different signature over different bytes.
    const legacySig = kp.sign(Buffer.from(message, "utf8"));
    expect(kp.verify(sep53Digest(message), legacySig)).toBe(false);
    expect(kp.verify(Buffer.from(message, "utf8"), sep53Sig)).toBe(false);
  });
});
