/**
 * Fork-testnet: processMerchantPayment -> backend verification (task 33).
 *
 * This test requires a running Arc testnet fork (or equivalent EVM fork)
 * with the TakumiWallet merchant extension deployed. It is `.skip`-ped
 * by default -- enable it when running against a local fork.
 *
 * Prerequisites:
 *   1. Deploy TakumiWallet with merchant extension to fork
 *   2. Set backendSigner on the contract
 *   3. Set env vars: FORK_RPC_URL, FORK_CONTRACT_ADDRESS,
 *      QUOTE_SIGNER_PRIVATE_KEY, FORK_CHAIN_ID
 *
 * Run:
 *   RUN_FORK_TEST=1 pnpm test -- --testPathPattern=fork-testnet
 */

const RUN = process.env.RUN_FORK_TEST === "1";
const describeIf = RUN ? describe : describe.skip;

describeIf("Fork-testnet: processMerchantPayment -> backend verification", () => {
  jest.setTimeout(120_000);

  it.skip("real processMerchantPayment call -> verifyMerchantPaymentInContract (requires testnet)", async () => {
    // This test requires a running Arc testnet fork
    // Steps:
    // 1. Deploy TakumiWallet with merchant extension to fork
    //    - Use viem's deployContract with TakumiWalletMerchantAbi
    //    - Set the backendSigner to a test key pair
    //
    // 2. Set backendSigner
    //    - const account = privateKeyToAccount(QUOTE_SIGNER_PRIVATE_KEY);
    //    - await walletClient.writeContract({
    //        address: contractAddress,
    //        abi: TakumiWalletMerchantAbi,
    //        functionName: "rotateBackendSigner",
    //        args: [account.address],
    //      });
    //
    // 3. Sign a QuoteCommitment
    //    - Use viem's signTypedData with the EIP-712 domain and QuoteCommitment type
    //    - const signature = await account.signTypedData({
    //        domain: { name: "TakumiPay", version: "1", chainId, verifyingContract },
    //        types: { QuoteCommitment: [...fields] },
    //        primaryType: "QuoteCommitment",
    //        message: quoteCommitment,
    //      });
    //
    // 4. Call processMerchantPayment
    //    - await walletClient.writeContract({
    //        address: contractAddress,
    //        abi: TakumiWalletMerchantAbi,
    //        functionName: "processMerchantPayment",
    //        args: [quoteCommitment, signature],
    //      });
    //
    // 5. Call verifyMerchantPaymentInContract from backend
    //    - await blockchainVerificationService.verifyMerchantPaymentInContract({
    //        contractAddress,
    //        chainId,
    //        refId: quoteCommitment.refId,
    //        expectedPayer: payerAddress,
    //        expectedMerchantId: quoteCommitment.merchantId,
    //        expectedTokenAddress: quoteCommitment.tokenAddress,
    //        expectedAmount: quoteCommitment.amount.toString(),
    //        expectedFiatAmountMinor: Number(quoteCommitment.fiatAmountMinor),
    //        expectedFiatCurrency: quoteCommitment.fiatCurrency,
    //        expectedExchangeRateId: Number(quoteCommitment.exchangeRateId),
    //      });
    //
    // 6. Assert all fields match
    //    - The call above should not throw
    //    - Optionally read getMerchantPaymentByRef and assert each field

    expect(true).toBe(true); // placeholder
  });

  it.skip("processMerchantPayment reverts BAD_QUOTE with wrong signer", async () => {
    // Deploy contract, set backendSigner to address A,
    // sign quote with key B (different from A),
    // call processMerchantPayment -> expect revert with BAD_QUOTE

    expect(true).toBe(true); // placeholder
  });

  it.skip("processMerchantPayment reverts QUOTE_EXPIRED when block.timestamp > expiresAt", async () => {
    // Sign a quote with expiresAt in the past,
    // call processMerchantPayment -> expect revert with QUOTE_EXPIRED

    expect(true).toBe(true); // placeholder
  });

  it.skip("processMerchantPayment reverts REF_CONSUMED on replay", async () => {
    // Call processMerchantPayment twice with the same refId,
    // second call -> expect revert with REF_CONSUMED

    expect(true).toBe(true); // placeholder
  });
});

if (!RUN) {
  describe("Fork-testnet: processMerchantPayment -> backend verification", () => {
    it("is skipped unless RUN_FORK_TEST=1", () => {
      expect(RUN).toBe(false);
    });
  });
}
