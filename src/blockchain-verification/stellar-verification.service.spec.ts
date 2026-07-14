import type { ConfigService } from "@nestjs/config";
import { Networks } from "@stellar/stellar-base";
import type { PrismaService } from "../prisma/prisma.service";
import { StellarVerificationService } from "./stellar-verification.service";
import type { MerchantQuoteParams } from "./stellar/takumi-pay/types";

const TESTNET_SIGNER_SECRET = "SAFH63JSU62WZ4EHIM4CYWDX4RZLUFAIYVMFWA7D44JRG4UYLPEN55FU";
const CONTRACT_ID = "CAEVSB5RGLRR3MVXUNMG67JRA4AAMZH4GR5WNCODSITO6YQI2W7XWD32";

/**
 * Golden value derived independently in a throwaway probe script (not
 * copy-pasted from this service's own implementation), then cross-checked
 * two more ways before being pinned here:
 *   1. The quote/message ScVal map key order this test's inputs produce
 *      ("amount", "exchange_rate_id", ... / "contract", "network_id",
 *      "quote") matches the field order stellar-cli prints for
 *      `process_merchant_payment --help` (derived from the deployed
 *      contract's own embedded spec, not from our TS code).
 *   2. A structurally identical quote (same field values, differing only
 *      in a soon-to-be-future `expires_at`) signed with this exact logic
 *      was submitted to the real deployed testnet contract via
 *      `process_merchant_payment` and accepted — `ed25519_verify` does
 *      not have a recoverable error path, so acceptance is proof the byte
 *      encoding is exact
 *      (tx d36b93cda14718e590335b82add73ecd5481013daee3f3386ac4b79bc83164e2).
 * Ed25519 signatures are deterministic (RFC 8032) for a given key+message,
 * so this fixed input set has exactly one correct signature.
 */
const EXPECTED_SIGNATURE_HEX =
  "f864a528d61bce6a505be327241f1fc253219770b654270391ff6b84a2d6b4f8aee40b5e8d34a2ffbf62ccb724be0e380591ac1cc93f5b85d028afd74306830d";

function buildService(secret: string | undefined = TESTNET_SIGNER_SECRET) {
  const prisma = {
    blockchain: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const config = {
    get: jest.fn((key: string) => (key === "STELLAR_QUOTE_SIGNER_PRIVATE_KEY" ? secret : undefined)),
  } as unknown as ConfigService;

  return new StellarVerificationService(prisma, config);
}

describe("StellarVerificationService.signMerchantQuote", () => {
  it("produces the exact signature bytes for a fixed quote (golden value, verified end-to-end on testnet)", async () => {
    const svc = buildService();
    await svc.onModuleInit();

    const params: MerchantQuoteParams = {
      refId: "quote-test-1",
      merchantId: "merchant-abc",
      token: "CDJGWVHOS6XGCL5MJJFL2WTCNSFCKAGKW2KFZQ6CDEYZICUPEWS5FT4E",
      amount: 1000000n,
      platformFeeAmount: 10000n,
      fiatAmountMinor: 5000000n,
      fiatCurrency: Buffer.from("IDR"),
      exchangeRateId: 42n,
      expiresAt: 1234567890n,
    };

    const signature = svc.signMerchantQuote(params, CONTRACT_ID, Networks.TESTNET);

    expect(signature.toString("hex")).toBe(EXPECTED_SIGNATURE_HEX);
    expect(signature.length).toBe(64);
  });

  it("exposes the configured signer's raw public key, matching the deployed testnet contract's backend_signer", async () => {
    const svc = buildService();
    await svc.onModuleInit();

    // From ../../../contract/stellar/deployments/testnet/v2.json backendSignerPubkey
    // (same signer key reused from v1.json — only the contract ID changed).
    expect(svc.getSignerPublicKey()).toBe(
      "04466f114c2f959229d812cc68731c4625fb869e8eefcf47d3da251f82ba93b4",
    );
  });

  it("throws when no signer secret is configured", async () => {
    // "" rather than `undefined` — buildService's default parameter would
    // substitute TESTNET_SIGNER_SECRET for an explicit `undefined` argument.
    const svc = buildService("");
    await svc.onModuleInit();

    expect(() =>
      svc.signMerchantQuote(
        {
          refId: "r",
          merchantId: "m",
          token: CONTRACT_ID,
          amount: 1n,
          platformFeeAmount: 0n,
          fiatAmountMinor: 1n,
          fiatCurrency: Buffer.from("IDR"),
          exchangeRateId: 1n,
          expiresAt: 1n,
        },
        CONTRACT_ID,
        Networks.TESTNET,
      ),
    ).toThrow(/Stellar quote signer not configured/);
  });
});
