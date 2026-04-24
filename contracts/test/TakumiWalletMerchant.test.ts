import { expect } from "chai";
import { ethers } from "hardhat";
import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";

describe("TakumiWalletMerchant", function () {
  // EIP-712 domain matching the contract constructor
  const DOMAIN = {
    name: "TakumiPay",
    version: "1",
  };

  const QUOTE_TYPES = {
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
  };

  async function deployFixture() {
    const [owner, backendSigner, payer, recipient, otherSigner] =
      await ethers.getSigners();

    const Factory = await ethers.getContractFactory("TakumiWalletMerchant");
    const contract = await Factory.deploy(backendSigner.address);
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();

    // Build domain with verifyingContract filled in
    const domain = {
      ...DOMAIN,
      chainId: (await ethers.provider.getNetwork()).chainId,
      verifyingContract: contractAddress,
    };

    // Helper: build a valid quote and sign it
    async function buildSignedQuote(
      overrides: Record<string, unknown> = {},
      signer = backendSigner,
    ) {
      const now = await time.latest();
      const quote = {
        refId: overrides.refId ?? "ref-001",
        merchantId: overrides.merchantId ?? "merchant-xyz",
        tokenAddress:
          overrides.tokenAddress ?? ethers.ZeroAddress, // native
        amount: overrides.amount ?? ethers.parseEther("1"),
        platformFeeAmount:
          overrides.platformFeeAmount ?? ethers.parseEther("0.01"),
        fiatAmountMinor: overrides.fiatAmountMinor ?? 1_500_000n, // 15000.00 IDR
        fiatCurrency: overrides.fiatCurrency ?? "0x494452", // "IDR"
        exchangeRateId: overrides.exchangeRateId ?? 42n,
        expiresAt: overrides.expiresAt ?? BigInt(now + 600), // 10 min from now
      };

      const signature = await signer.signTypedData(
        domain,
        QUOTE_TYPES,
        quote,
      );

      return { quote, signature };
    }

    return {
      contract,
      contractAddress,
      owner,
      backendSigner,
      payer,
      recipient,
      otherSigner,
      domain,
      buildSignedQuote,
    };
  }

  // ─── Happy path ───────────────────────────────────────────────────
  describe("processMerchantPayment - happy path (native)", function () {
    it("should accept a valid native payment and persist it", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const { quote, signature } = await buildSignedQuote();

      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: quote.amount,
          }),
      ).to.emit(contract, "MerchantPaymentProcessed");

      // Verify stored payment
      const stored = await contract.getMerchantPaymentByRef("ref-001");
      expect(stored.payer).to.equal(payer.address);
      expect(stored.amount).to.equal(quote.amount);
      expect(stored.merchantId).to.equal("merchant-xyz");
      expect(stored.refId).to.equal("ref-001");
      expect(stored.platformFeeAmount).to.equal(quote.platformFeeAmount);
      expect(stored.fiatAmountMinor).to.equal(1_500_000n);
      expect(stored.fiatCurrency).to.equal("0x494452");
      expect(stored.exchangeRateId).to.equal(42n);
      expect(stored.timestamp).to.be.gt(0n);

      // Platform fee accrued
      expect(
        await contract.platformFeeAccrued(ethers.ZeroAddress),
      ).to.equal(quote.platformFeeAmount);
    });
  });

  // ─── Revert: QUOTE_EXPIRED ────────────────────────────────────────
  describe("processMerchantPayment - QUOTE_EXPIRED", function () {
    it("should revert when the quote has expired", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const now = await time.latest();
      const { quote, signature } = await buildSignedQuote({
        expiresAt: BigInt(now - 1), // already expired
      });

      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: quote.amount,
          }),
      ).to.be.revertedWith("QUOTE_EXPIRED");
    });
  });

  // ─── Revert: REF_CONSUMED (replay) ───────────────────────────────
  describe("processMerchantPayment - REF_CONSUMED", function () {
    it("should revert on replay with the same refId", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const { quote, signature } = await buildSignedQuote();

      // First call succeeds
      await contract
        .connect(payer)
        .processMerchantPayment(quote, signature, {
          value: quote.amount,
        });

      // Second call with same refId reverts
      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: quote.amount,
          }),
      ).to.be.revertedWith("REF_CONSUMED");
    });
  });

  // ─── Revert: BAD_QUOTE (wrong signer) ────────────────────────────
  describe("processMerchantPayment - BAD_QUOTE", function () {
    it("should revert when signature is from wrong signer", async function () {
      const { contract, payer, otherSigner, buildSignedQuote } =
        await loadFixture(deployFixture);

      // Sign with otherSigner instead of backendSigner
      const { quote, signature } = await buildSignedQuote(
        {},
        otherSigner,
      );

      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: quote.amount,
          }),
      ).to.be.revertedWith("BAD_QUOTE");
    });
  });

  // ─── Revert: FEE_EXCEEDS_AMOUNT ──────────────────────────────────
  describe("processMerchantPayment - FEE_EXCEEDS_AMOUNT", function () {
    it("should revert when platformFeeAmount > amount", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const { quote, signature } = await buildSignedQuote({
        amount: ethers.parseEther("1"),
        platformFeeAmount: ethers.parseEther("2"), // fee > amount
      });

      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: quote.amount,
          }),
      ).to.be.revertedWith("FEE_EXCEEDS_AMOUNT");
    });
  });

  // ─── Revert: NATIVE_AMOUNT_MISMATCH ──────────────────────────────
  describe("processMerchantPayment - NATIVE_AMOUNT_MISMATCH", function () {
    it("should revert when msg.value does not match quote.amount for native", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const { quote, signature } = await buildSignedQuote();

      await expect(
        contract
          .connect(payer)
          .processMerchantPayment(quote, signature, {
            value: ethers.parseEther("0.5"), // wrong amount
          }),
      ).to.be.revertedWith("NATIVE_AMOUNT_MISMATCH");
    });
  });

  // ─── sweepPlatformFees ────────────────────────────────────────────
  describe("sweepPlatformFees", function () {
    it("should sweep accrued fees to recipient", async function () {
      const { contract, payer, owner, recipient, buildSignedQuote } =
        await loadFixture(deployFixture);

      // First, process a payment to accrue fees
      const { quote, signature } = await buildSignedQuote();
      await contract
        .connect(payer)
        .processMerchantPayment(quote, signature, {
          value: quote.amount,
        });

      const fee = quote.platformFeeAmount;

      // Sweep should work
      await expect(
        contract
          .connect(owner)
          .sweepPlatformFees(ethers.ZeroAddress, recipient.address, fee),
      )
        .to.emit(contract, "PlatformFeesSwept")
        .withArgs(ethers.ZeroAddress, recipient.address, fee);

      // Accrued should now be 0
      expect(
        await contract.platformFeeAccrued(ethers.ZeroAddress),
      ).to.equal(0n);
    });

    it("should revert when sweeping more than accrued", async function () {
      const { contract, owner, recipient } =
        await loadFixture(deployFixture);

      await expect(
        contract
          .connect(owner)
          .sweepPlatformFees(
            ethers.ZeroAddress,
            recipient.address,
            ethers.parseEther("1"),
          ),
      ).to.be.revertedWith("FEE_AMOUNT_INVALID");
    });

    it("should revert when sweeping zero", async function () {
      const { contract, owner, recipient } =
        await loadFixture(deployFixture);

      await expect(
        contract
          .connect(owner)
          .sweepPlatformFees(ethers.ZeroAddress, recipient.address, 0n),
      ).to.be.revertedWith("FEE_AMOUNT_INVALID");
    });

    it("should revert when called by non-owner", async function () {
      const { contract, payer, recipient } =
        await loadFixture(deployFixture);

      await expect(
        contract
          .connect(payer)
          .sweepPlatformFees(
            ethers.ZeroAddress,
            recipient.address,
            ethers.parseEther("1"),
          ),
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ─── rotateBackendSigner ──────────────────────────────────────────
  describe("rotateBackendSigner", function () {
    it("should rotate the backend signer", async function () {
      const { contract, owner, backendSigner, otherSigner } =
        await loadFixture(deployFixture);

      await expect(
        contract.connect(owner).rotateBackendSigner(otherSigner.address),
      )
        .to.emit(contract, "BackendSignerRotated")
        .withArgs(backendSigner.address, otherSigner.address);

      expect(await contract.backendSigner()).to.equal(otherSigner.address);
    });

    it("should revert when setting zero address", async function () {
      const { contract, owner } = await loadFixture(deployFixture);

      await expect(
        contract.connect(owner).rotateBackendSigner(ethers.ZeroAddress),
      ).to.be.revertedWith("ZERO_SIGNER");
    });

    it("should revert when called by non-owner", async function () {
      const { contract, payer, otherSigner } =
        await loadFixture(deployFixture);

      await expect(
        contract.connect(payer).rotateBackendSigner(otherSigner.address),
      ).to.be.revertedWithCustomError(contract, "OwnableUnauthorizedAccount");
    });
  });

  // ─── getMerchantPaymentByRef ──────────────────────────────────────
  describe("getMerchantPaymentByRef", function () {
    it("should return correct payment data after processing", async function () {
      const { contract, payer, buildSignedQuote } =
        await loadFixture(deployFixture);

      const { quote, signature } = await buildSignedQuote({
        refId: "lookup-test",
        merchantId: "merchant-abc",
        amount: ethers.parseEther("2.5"),
        platformFeeAmount: ethers.parseEther("0.05"),
      });

      await contract
        .connect(payer)
        .processMerchantPayment(quote, signature, {
          value: quote.amount,
        });

      const payment = await contract.getMerchantPaymentByRef("lookup-test");
      expect(payment.payer).to.equal(payer.address);
      expect(payment.tokenAddress).to.equal(ethers.ZeroAddress);
      expect(payment.merchantId).to.equal("merchant-abc");
      expect(payment.refId).to.equal("lookup-test");
      expect(payment.amount).to.equal(ethers.parseEther("2.5"));
      expect(payment.platformFeeAmount).to.equal(ethers.parseEther("0.05"));
    });

    it("should return empty struct for unknown refId", async function () {
      const { contract } = await loadFixture(deployFixture);

      const payment =
        await contract.getMerchantPaymentByRef("nonexistent");
      expect(payment.payer).to.equal(ethers.ZeroAddress);
      expect(payment.amount).to.equal(0n);
      expect(payment.timestamp).to.equal(0n);
    });
  });
});
