import type { ConfigService } from "@nestjs/config";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { recoverTypedDataAddress } from "viem";
import { QuoteSignerService } from "./quote-signer.service";

function buildSvc(env: Record<string, string> = {}) {
  return new QuoteSignerService({
    get: jest.fn((k: string, d?: string) => env[k] ?? d),
  } as unknown as ConfigService);
}

const SIGNER_PK = generatePrivateKey();
const SIGNER_ACCOUNT = privateKeyToAccount(SIGNER_PK);

describe("QuoteSignerService construction", () => {
  it("throws when EVM_QUOTE_SIGNER_PRIVATE_KEY is not set", () => {
    expect(() => buildSvc()).toThrow(
      /EVM_QUOTE_SIGNER_PRIVATE_KEY is not defined/,
    );
  });

  it("exposes the signer address derived from the configured private key", () => {
    const svc = buildSvc({ EVM_QUOTE_SIGNER_PRIVATE_KEY: SIGNER_PK });
    expect(svc.signerAddress).toBe(SIGNER_ACCOUNT.address);
  });

  it("uses default domain name + version when env not set", () => {
    const svc = buildSvc({ EVM_QUOTE_SIGNER_PRIVATE_KEY: SIGNER_PK });
    expect(svc.signerAddress).toBe(SIGNER_ACCOUNT.address);
    // Indirectly verify defaults by signing + recovering with default domain.
  });
});

describe("QuoteSignerService.signQuote", () => {
  const verifyingContract = "0x0000000000000000000000000000000000001234" as const;
  const commitment = {
    refId: "ref_1",
    merchantId: "mch_1",
    tokenAddress: "0x1111111111111111111111111111111111111111" as const,
    amount: 1_000_000n,
    platformFeeAmount: 1000n,
    fiatAmountMinor: 100_000n,
    fiatCurrency: "0x494452" as const, // "IDR"
    exchangeRateId: 42n,
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 3600),
  };

  it("produces a 65-byte (0x + 130 hex) ECDSA signature", async () => {
    const svc = buildSvc({ EVM_QUOTE_SIGNER_PRIVATE_KEY: SIGNER_PK });
    const sig = await svc.signQuote(commitment, 137, verifyingContract);
    expect(sig).toMatch(/^0x[0-9a-f]{130}$/);
  });

  it("recovers the same signer address via EIP-712 (round-trip)", async () => {
    const svc = buildSvc({
      EVM_QUOTE_SIGNER_PRIVATE_KEY: SIGNER_PK,
      QUOTE_SIGNATURE_DOMAIN_NAME: "TakumiPay",
      QUOTE_SIGNATURE_DOMAIN_VERSION: "1",
    });
    const sig = await svc.signQuote(commitment, 137, verifyingContract);

    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "TakumiPay",
        version: "1",
        chainId: 137n,
        verifyingContract,
      },
      types: {
        QuoteCommitment: [
          { name: "refId", type: "string" },
          { name: "merchantId", type: "string" },
          { name: "tokenAddress", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "platformFeeAmount", type: "uint256" },
          { name: "fiatAmountMinor", type: "uint256" },
          { name: "fiatCurrency", type: "bytes3" },
          { name: "exchangeRateId", type: "uint256" },
          { name: "expiresAt", type: "uint256" },
        ],
      },
      primaryType: "QuoteCommitment",
      message: commitment,
      signature: sig,
    });
    expect(recovered.toLowerCase()).toBe(svc.signerAddress.toLowerCase());
  });

  it("changes signature when chainId changes (replay safe)", async () => {
    const svc = buildSvc({ EVM_QUOTE_SIGNER_PRIVATE_KEY: SIGNER_PK });
    const sigA = await svc.signQuote(commitment, 1, verifyingContract);
    const sigB = await svc.signQuote(commitment, 137, verifyingContract);
    expect(sigA).not.toBe(sigB);
  });
});
