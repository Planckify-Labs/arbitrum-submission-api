import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  Contract,
  Account,
  TransactionBuilder,
  Networks,
  BASE_FEE,
  nativeToScVal,
  scValToNative,
  xdr,
  Address,
  Asset,
  Keypair,
  hash,
} from "@stellar/stellar-base";
// Soroban RPC client only — see stellar-sdk-rpc.d.ts for why this comes
// from the /rpc subpath instead of the top-level @stellar/stellar-sdk
// package (which would drag in an ESM-only transitive dependency).
import { Server as SorobanServer, Api as SorobanApi } from "@stellar/stellar-sdk/rpc";
import { PrismaService } from "../prisma/prisma.service";
import type {
  StellarTransactionRecord,
  StellarMerchantPayment,
  StellarPointDepositRecord,
  MerchantQuoteParams,
} from "./stellar/takumi-pay/types";
import type { TTransactionVerificationResult } from "./types/blockchain-verification.types";
import { resolveRpcEndpoint } from "../blockchains/rpc-endpoint";

/** Stable machine key in SmartContract.name — see blockchain-verification.service.ts's own copy of this constant. */
const TAKUMI_PAY_CONTRACT_NAME = "takumi_pay";

interface StellarClient {
  server: SorobanServer;
  networkPassphrase: string;
  contract: Contract | null;
}

function sym(name: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(name);
}

/**
 * `@stellar/stellar-base@15.0.0` (this repo's existing dependency, reused
 * here for everything except the Soroban RPC client — see the import
 * comment above) predates `scvSortedMap`, added later when stellar-base was
 * folded into `@stellar/stellar-sdk`. Reimplemented locally: sorts map
 * entries by their Symbol key, matching exactly what soroban-sdk's
 * `#[contracttype]` derive macro does on the Rust side (see
 * `signMerchantQuote`'s doc comment) — verified to produce identical output
 * to the real `scvSortedMap` via a throwaway probe against the installed
 * `@stellar/stellar-sdk`.
 */
function scvSortedMap(entries: xdr.ScMapEntry[]): xdr.ScVal {
  const sorted = [...entries].sort((a, b) => {
    const aKey = a.key().sym().toString();
    const bKey = b.key().sym().toString();
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
  return xdr.ScVal.scvMap(sorted);
}

/**
 * Bridges the classic-asset identity (`"{CODE}:{ISSUER}"`, the compound
 * string stored on Stellar `Token` rows for the mobile wallet's trustline
 * flow) to the Soroban Stellar Asset Contract id the `takumi_pay` contract
 * actually stores/expects as `token: Address`. Deterministic — verified
 * against the real deployed testnet USDC SAC
 * (`Asset("USDC", issuer).contractId(Networks.TESTNET)` reproduces
 * `CDJGWVHOS6XGCL5MJJFL2WTCNSFCKAGKW2KFZQ6CDEYZICUPEWS5FT4E` exactly).
 */
function resolveStellarTokenContractId(
  tokenAddressOrCompound: string,
  networkPassphrase: string,
): string {
  if (tokenAddressOrCompound.startsWith("C")) {
    return tokenAddressOrCompound;
  }
  const [code, issuer] = tokenAddressOrCompound.split(":");
  if (!code || !issuer) {
    throw new Error(
      `Invalid Stellar token identifier: ${tokenAddressOrCompound}`,
    );
  }
  return new Asset(code, issuer).contractId(networkPassphrase);
}

@Injectable()
export class StellarVerificationService implements OnModuleInit {
  private readonly logger = new Logger(StellarVerificationService.name);
  private readonly clients: Map<string, StellarClient> = new Map();
  private signerKeypair: Keypair | null = null;

  private static readonly STELLAR_SLUGS = ["stellar-mainnet", "stellar-testnet"];

  // Simulation-only reads don't submit a transaction, so the source account
  // never needs to exist or be funded — any syntactically valid StrKey
  // works (verified empirically against the deployed testnet contract).
  private static readonly SIMULATION_SOURCE = Keypair.random().publicKey();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    await this.initializeClients();

    const secret = this.config.get<string>("STELLAR_QUOTE_SIGNER_PRIVATE_KEY");
    if (secret) {
      try {
        this.signerKeypair = Keypair.fromSecret(secret);
      } catch {
        this.logger.warn("Failed to parse STELLAR_QUOTE_SIGNER_PRIVATE_KEY");
      }
    }
  }

  private async initializeClients() {
    const chains = await this.prisma.blockchain.findMany({
      where: {
        chainSlug: { in: StellarVerificationService.STELLAR_SLUGS },
        isActive: true,
      },
    });

    for (const chain of chains) {
      // Soroban RPC endpoint — `rpcUrl` on Stellar rows, not a dedicated
      // column (see the schema comment on `Blockchain.type`). Stored as an
      // rpc-proxy route, so resolve it and carry the proxy bearer.
      const rpc = resolveRpcEndpoint(chain.rpcUrl);
      const server = new SorobanServer(rpc.url, {
        headers: rpc.headers,
        // SorobanServer refuses plain HTTP unless opted in, and a local
        // rpc-proxy is http://localhost:8787. Derived from the URL rather than
        // hardcoded so production (https) stays strict.
        allowHttp: rpc.url.startsWith("http://"),
      });
      const networkPassphrase = chain.isTestnet ? Networks.TESTNET : Networks.PUBLIC;

      // `takumi_pay`'s contract address lives in SmartContract (name:
      // "takumi_pay"), the same per-chain contract registry EVM uses —
      // not a scalar column on Blockchain (see that same schema comment).
      const contractRow = await this.prisma.smartContract.findFirst({
        where: { blockchainId: chain.id, name: TAKUMI_PAY_CONTRACT_NAME, isActive: true },
      });
      const contract = contractRow ? new Contract(contractRow.address) : null;
      if (!contract) {
        this.logger.warn(
          `Blockchain ${chain.name} (${chain.id}) has no active "${TAKUMI_PAY_CONTRACT_NAME}" SmartContract row — contract calls will fail until one is seeded`,
        );
      }

      this.clients.set(chain.id, { server, networkPassphrase, contract });
      this.logger.log(
        `Initialized Stellar client for ${chain.name} (slug: ${chain.chainSlug})`,
      );
    }
  }

  private getClient(blockchainId: string): StellarClient {
    const client = this.clients.get(blockchainId);
    if (!client) {
      throw new Error(
        `No Stellar client initialized for blockchain ${blockchainId}`,
      );
    }
    return client;
  }

  private requireContract(client: StellarClient): Contract {
    if (!client.contract) {
      throw new Error("Blockchain has no takumiPayContractId configured");
    }
    return client.contract;
  }

  /**
   * Read-only contract call via `simulateTransaction` — no signing, no
   * submission, no fee actually charged. Verified empirically against the
   * deployed testnet contract's `get_transaction`.
   */
  private async simulateRead(
    client: StellarClient,
    method: string,
    args: xdr.ScVal[],
  ): Promise<unknown> {
    const contract = this.requireContract(client);
    const account = new Account(StellarVerificationService.SIMULATION_SOURCE, "0");
    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    // `tx` is built with @stellar/stellar-base's TransactionBuilder (this
    // repo's existing dependency); `simulateTransaction`'s parameter type
    // comes from @stellar/stellar-sdk's own bundled (structurally identical,
    // nominally distinct) copy of the same class — see the import comment
    // at the top of this file for why they're two separate packages.
    const sim = await client.server.simulateTransaction(tx as unknown as Parameters<typeof client.server.simulateTransaction>[0]);
    if (SorobanApi.isSimulationError(sim)) {
      throw new Error(`Soroban simulation failed for ${method}: ${sim.error}`);
    }
    if (!sim.result?.retval) {
      return null;
    }
    return scValToNative(sim.result.retval);
  }

  /**
   * Polls `getTransaction` until it leaves NOT_FOUND or times out. Soroban
   * RPC has no blocking "wait for receipt" call analogous to viem's
   * `waitForTransactionReceipt`; ledgers close roughly every 5s on testnet
   * and mainnet alike.
   */
  private async waitForTransaction(
    server: SorobanServer,
    hashHex: string,
    timeoutMs = 30_000,
  ): Promise<SorobanApi.GetTransactionResponse> {
    const start = Date.now();
    for (;;) {
      const res = await server.getTransaction(hashHex);
      if (res.status !== SorobanApi.GetTransactionStatus.NOT_FOUND) {
        return res;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Timeout waiting for Stellar transaction ${hashHex}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  async verifyTransaction(args: {
    blockchainId: string;
    transactionHash: string;
    refId: string;
    expectedWalletAddress: string;
    expectedTokenAddress: string;
    expectedAmount: string;
    expectedBookingId: string;
    expectedExchangeRateId: string;
    expectedProductVariantId: string;
  }): Promise<TTransactionVerificationResult> {
    const client = this.getClient(args.blockchainId);

    const txResponse = await this.waitForTransaction(client.server, args.transactionHash);
    if (txResponse.status !== SorobanApi.GetTransactionStatus.SUCCESS) {
      throw new Error(
        `Stellar transaction ${args.transactionHash} did not succeed (status: ${txResponse.status})`,
      );
    }
    if (!txResponse.returnValue) {
      throw new Error(
        `Stellar transaction ${args.transactionHash} has no return value`,
      );
    }
    const txId = scValToNative(txResponse.returnValue) as bigint;

    const record = await this.verifyTransactionRecord({
      blockchainId: args.blockchainId,
      txId,
      refId: args.refId,
      expectedWalletAddress: args.expectedWalletAddress,
      expectedTokenAddress: args.expectedTokenAddress,
      expectedAmount: args.expectedAmount,
      expectedBookingId: args.expectedBookingId,
      expectedExchangeRateId: args.expectedExchangeRateId,
      expectedProductVariantId: args.expectedProductVariantId,
    });

    return {
      isValid: true,
      transactionHash: args.transactionHash,
      blockNumber: txResponse.ledger.toString(),
      confirmations: 1,
      from: record.walletAddress,
      to: this.requireContract(client).contractId(),
      value: record.amount.toString(),
      status: "success",
      gasUsed: "0",
      blockTimestamp: txResponse.createdAt.toString(),
      chainId: 0,
    };
  }

  async verifyTransactionRecord(args: {
    blockchainId: string;
    txId: bigint;
    refId: string;
    expectedWalletAddress: string;
    expectedTokenAddress: string;
    expectedAmount: string;
    expectedBookingId: string;
    expectedExchangeRateId: string;
    expectedProductVariantId: string;
  }): Promise<StellarTransactionRecord> {
    const client = this.getClient(args.blockchainId);
    const raw = (await this.simulateRead(
      client,
      "get_transaction",
      [nativeToScVal(args.txId, { type: "u64" })],
    )) as Record<string, unknown> | null;

    if (!raw) {
      throw new Error(`Stellar transaction record ${args.txId} not found on-chain`);
    }

    const record: StellarTransactionRecord = {
      txId: raw.tx_id as bigint,
      walletAddress: raw.wallet_address as string,
      token: raw.token as string,
      bookingId: raw.booking_id as string,
      exchangeRateId: raw.exchange_rate_id as bigint,
      productVariantId: raw.product_variant_id as string,
      refId: raw.ref_id as string,
      amount: raw.amount as bigint,
      timestamp: raw.timestamp as bigint,
    };

    if (record.refId !== args.refId) {
      throw new Error(
        `Stellar refId mismatch: expected ${args.refId}, got ${record.refId}`,
      );
    }
    if (record.walletAddress !== args.expectedWalletAddress) {
      throw new Error(
        `Stellar wallet address mismatch: expected ${args.expectedWalletAddress}, got ${record.walletAddress}`,
      );
    }
    const expectedTokenId = resolveStellarTokenContractId(
      args.expectedTokenAddress,
      client.networkPassphrase,
    );
    if (record.token !== expectedTokenId) {
      throw new Error(
        `Stellar token mismatch: expected ${expectedTokenId}, got ${record.token}`,
      );
    }
    if (record.amount.toString() !== args.expectedAmount) {
      throw new Error(
        `Stellar amount mismatch: expected ${args.expectedAmount}, got ${record.amount.toString()}`,
      );
    }
    if (args.expectedBookingId && record.bookingId !== args.expectedBookingId) {
      throw new Error(
        `Stellar bookingId mismatch: expected ${args.expectedBookingId}, got ${record.bookingId}`,
      );
    }
    if (
      args.expectedExchangeRateId &&
      record.exchangeRateId.toString() !== args.expectedExchangeRateId
    ) {
      throw new Error(
        `Stellar exchangeRateId mismatch: expected ${args.expectedExchangeRateId}, got ${record.exchangeRateId.toString()}`,
      );
    }
    if (
      args.expectedProductVariantId &&
      record.productVariantId !== args.expectedProductVariantId
    ) {
      throw new Error(
        `Stellar productVariantId mismatch: expected ${args.expectedProductVariantId}, got ${record.productVariantId}`,
      );
    }

    return record;
  }

  async verifyMerchantPayment(args: {
    blockchainId: string;
    refId: string;
    expectedPayer: string;
    expectedMerchantId: string;
    expectedTokenAddress: string;
    expectedAmount: string;
    expectedFiatAmountMinor: number;
    expectedFiatCurrency: string;
    expectedExchangeRateId: number;
  }): Promise<StellarMerchantPayment> {
    const client = this.getClient(args.blockchainId);
    const raw = (await this.simulateRead(
      client,
      "get_merchant_payment",
      [nativeToScVal(args.refId, { type: "string" })],
    )) as Record<string, unknown> | null;

    if (!raw) {
      throw new Error(`Stellar merchant payment ${args.refId} not found on-chain`);
    }

    const payment: StellarMerchantPayment = {
      payer: raw.payer as string,
      token: raw.token as string,
      merchantId: raw.merchant_id as string,
      refId: raw.ref_id as string,
      amount: raw.amount as bigint,
      platformFeeAmount: raw.platform_fee_amount as bigint,
      fiatAmountMinor: raw.fiat_amount_minor as bigint,
      fiatCurrency: Buffer.from(raw.fiat_currency as Uint8Array),
      exchangeRateId: raw.exchange_rate_id as bigint,
      timestamp: raw.timestamp as bigint,
    };

    // The payer's Stellar G-address isn't reliably known server-side (the user
    // may pay from any of their wallets), so skip the check when the caller
    // passes an empty expectation — the backend-signed quote already binds the
    // record to this exact intent, which is the real forgery guard. When a
    // caller does know the payer, the strict check still runs.
    if (args.expectedPayer && payment.payer !== args.expectedPayer) {
      throw new Error(
        `Stellar merchant payment payer mismatch: expected ${args.expectedPayer}, got ${payment.payer}`,
      );
    }
    if (payment.merchantId !== args.expectedMerchantId) {
      throw new Error(
        `Stellar merchant payment merchantId mismatch: expected ${args.expectedMerchantId}, got ${payment.merchantId}`,
      );
    }
    const expectedTokenId = resolveStellarTokenContractId(
      args.expectedTokenAddress,
      client.networkPassphrase,
    );
    if (payment.token !== expectedTokenId) {
      throw new Error(
        `Stellar merchant payment token mismatch: expected ${expectedTokenId}, got ${payment.token}`,
      );
    }
    if (payment.amount.toString() !== args.expectedAmount) {
      throw new Error(
        `Stellar merchant payment amount mismatch: expected ${args.expectedAmount}, got ${payment.amount.toString()}`,
      );
    }
    if (Number(payment.fiatAmountMinor) !== args.expectedFiatAmountMinor) {
      throw new Error(
        `Stellar merchant payment fiatAmountMinor mismatch: expected ${args.expectedFiatAmountMinor}, got ${payment.fiatAmountMinor}`,
      );
    }
    if (Number(payment.exchangeRateId) !== args.expectedExchangeRateId) {
      throw new Error(
        `Stellar merchant payment exchangeRateId mismatch: expected ${args.expectedExchangeRateId}, got ${payment.exchangeRateId}`,
      );
    }

    return payment;
  }

  async verifyPointDeposit(args: {
    blockchainId: string;
    transactionHash: string;
    refId: string;
    expectedWalletAddress: string;
    expectedTokenAddress: string;
    expectedAmount: bigint;
  }): Promise<StellarPointDepositRecord> {
    const client = this.getClient(args.blockchainId);

    const txResponse = await this.waitForTransaction(client.server, args.transactionHash);
    if (txResponse.status !== SorobanApi.GetTransactionStatus.SUCCESS) {
      throw new Error(
        `Stellar transaction ${args.transactionHash} did not succeed (status: ${txResponse.status})`,
      );
    }
    if (!txResponse.returnValue) {
      throw new Error(
        `Stellar transaction ${args.transactionHash} has no return value`,
      );
    }
    const depositId = scValToNative(txResponse.returnValue) as bigint;

    const raw = (await this.simulateRead(
      client,
      "get_point_deposit",
      [nativeToScVal(depositId, { type: "u64" })],
    )) as Record<string, unknown> | null;

    if (!raw) {
      throw new Error(`Stellar point deposit ${depositId} not found on-chain`);
    }

    const deposit: StellarPointDepositRecord = {
      depositId: raw.deposit_id as bigint,
      walletAddress: raw.wallet_address as string,
      token: raw.token as string,
      amount: raw.amount as bigint,
      refId: raw.ref_id as string,
      timestamp: raw.timestamp as bigint,
    };

    if (deposit.refId !== args.refId) {
      throw new Error(
        `Stellar point deposit refId mismatch: expected ${args.refId}, got ${deposit.refId}`,
      );
    }
    if (deposit.walletAddress !== args.expectedWalletAddress) {
      throw new Error(
        `Stellar point deposit wallet mismatch: expected ${args.expectedWalletAddress}, got ${deposit.walletAddress}`,
      );
    }
    const expectedTokenId = resolveStellarTokenContractId(
      args.expectedTokenAddress,
      client.networkPassphrase,
    );
    if (deposit.token !== expectedTokenId) {
      throw new Error(
        `Stellar point deposit token mismatch: expected ${expectedTokenId}, got ${deposit.token}`,
      );
    }
    if (deposit.amount !== args.expectedAmount) {
      throw new Error(
        `Stellar point deposit amount mismatch: expected ${args.expectedAmount}, got ${deposit.amount}`,
      );
    }

    return deposit;
  }

  getSignerPublicKey(): string | null {
    return this.signerKeypair ? this.signerKeypair.rawPublicKey().toString("hex") : null;
  }

  /**
   * Builds the `QuoteMessage { network_id, contract, quote }` the Soroban
   * contract reconstructs and verifies via `ed25519_verify`, then signs it.
   *
   * The `#[contracttype]` derive macro (soroban-sdk-macros 27.0.0, the exact
   * version this contract is built with — see
   * `~/.cargo/registry/.../soroban-sdk-macros-27.0.0/src/derive_struct.rs`)
   * serializes struct fields as an `ScVal::Map` sorted alphabetically by
   * Rust field name, not declaration order. `scvSortedMap` reproduces that
   * ordering. Verified byte-correct end-to-end: a quote signed with this
   * exact logic was accepted by the deployed testnet contract's
   * `process_merchant_payment` (tx
   * d36b93cda14718e590335b82add73ecd5481013daee3f3386ac4b79bc83164e2).
   */
  signMerchantQuote(params: MerchantQuoteParams, contractId: string, networkPassphrase: string): Buffer {
    if (!this.signerKeypair) {
      throw new Error("Stellar quote signer not configured");
    }

    const quoteEntries = [
      new xdr.ScMapEntry({ key: sym("ref_id"), val: nativeToScVal(params.refId, { type: "string" }) }),
      new xdr.ScMapEntry({ key: sym("merchant_id"), val: nativeToScVal(params.merchantId, { type: "string" }) }),
      new xdr.ScMapEntry({ key: sym("token"), val: new Address(params.token).toScVal() }),
      new xdr.ScMapEntry({ key: sym("amount"), val: nativeToScVal(params.amount, { type: "i128" }) }),
      new xdr.ScMapEntry({
        key: sym("platform_fee_amount"),
        val: nativeToScVal(params.platformFeeAmount, { type: "i128" }),
      }),
      new xdr.ScMapEntry({
        key: sym("fiat_amount_minor"),
        val: nativeToScVal(params.fiatAmountMinor, { type: "u64" }),
      }),
      new xdr.ScMapEntry({ key: sym("fiat_currency"), val: nativeToScVal(params.fiatCurrency) }),
      new xdr.ScMapEntry({
        key: sym("exchange_rate_id"),
        val: nativeToScVal(params.exchangeRateId, { type: "u64" }),
      }),
      new xdr.ScMapEntry({ key: sym("expires_at"), val: nativeToScVal(params.expiresAt, { type: "u64" }) }),
    ];
    const quoteScVal = scvSortedMap(quoteEntries);

    const networkId = hash(Buffer.from(networkPassphrase));
    const messageEntries = [
      new xdr.ScMapEntry({ key: sym("network_id"), val: nativeToScVal(networkId) }),
      new xdr.ScMapEntry({ key: sym("contract"), val: new Address(contractId).toScVal() }),
      new xdr.ScMapEntry({ key: sym("quote"), val: quoteScVal }),
    ];
    const messageScVal = scvSortedMap(messageEntries);

    const messageBytes = messageScVal.toXDR();
    return this.signerKeypair.sign(messageBytes);
  }

  /**
   * One-shot helper for the intent flow: resolves this chain's `takumi_pay`
   * contract id + network passphrase + the token's SAC id, signs the quote,
   * and returns the wire-ready commitment (all decimal strings), the base64
   * signature, the backend signer pubkey (hex), and the contract id.
   *
   * Encapsulates every Stellar-specific detail so `IntentsService` never
   * reaches into Soroban internals. Returns `null` — caller emits an unsigned
   * intent + warns (mirrors the SVM "no signer" path) — when the quote signer
   * isn't configured or this chain has no `takumi_pay` contract.
   *
   * `amount` / `platformFeeAmount` must already be in the token's own decimals
   * (Stellar USDC is 7, not the 6 the intent's USDC-micros use) — the caller
   * scales before calling.
   */
  buildMerchantQuoteSignature(args: {
    blockchainId: string;
    refId: string;
    merchantId: string;
    /** `"{CODE}:{ISSUER}"` compound (or a `C…` SAC id) from the Token row. */
    tokenCompound: string;
    amount: bigint;
    platformFeeAmount: bigint;
    fiatAmountMinor: bigint;
    /** 3-char ISO-4217 currency (e.g. `"IDR"`). */
    fiatCurrency: string;
    exchangeRateId: bigint;
    expiresAt: bigint;
  }): {
    commitment: {
      refId: string;
      merchantId: string;
      token: string;
      amount: string;
      platformFeeAmount: string;
      fiatAmountMinor: string;
      fiatCurrency: string;
      exchangeRateId: string;
      expiresAt: string;
    };
    signatureBase64: string;
    backendSignerPubkeyHex: string;
    contractId: string;
  } | null {
    if (!this.signerKeypair) {
      this.logger.warn(
        "Stellar quote signer not configured — intent quote left unsigned",
      );
      return null;
    }
    const client = this.clients.get(args.blockchainId);
    if (!client?.contract) {
      this.logger.warn(
        `No active "${TAKUMI_PAY_CONTRACT_NAME}" contract for blockchain ${args.blockchainId} — intent quote left unsigned`,
      );
      return null;
    }
    const contractId = client.contract.contractId();
    const tokenSacId = resolveStellarTokenContractId(
      args.tokenCompound,
      client.networkPassphrase,
    );

    // Byte-identical to the mobile encoder's BytesN<3> handling
    // (services/chains/stellar/takumiPay/encoding.ts) — charCode & 0xff, NUL-pad.
    const fiatBytes = Buffer.alloc(3);
    for (let i = 0; i < 3; i++) {
      fiatBytes[i] =
        i < args.fiatCurrency.length ? args.fiatCurrency.charCodeAt(i) & 0xff : 0;
    }

    const params: MerchantQuoteParams = {
      refId: args.refId,
      merchantId: args.merchantId,
      token: tokenSacId,
      amount: args.amount,
      platformFeeAmount: args.platformFeeAmount,
      fiatAmountMinor: args.fiatAmountMinor,
      fiatCurrency: fiatBytes,
      exchangeRateId: args.exchangeRateId,
      expiresAt: args.expiresAt,
    };
    const sig = this.signMerchantQuote(params, contractId, client.networkPassphrase);

    return {
      commitment: {
        refId: args.refId,
        merchantId: args.merchantId,
        token: tokenSacId,
        amount: args.amount.toString(),
        platformFeeAmount: args.platformFeeAmount.toString(),
        fiatAmountMinor: args.fiatAmountMinor.toString(),
        fiatCurrency: args.fiatCurrency,
        exchangeRateId: args.exchangeRateId.toString(),
        expiresAt: args.expiresAt.toString(),
      },
      signatureBase64: sig.toString("base64"),
      backendSignerPubkeyHex: this.signerKeypair.rawPublicKey().toString("hex"),
      contractId,
    };
  }
}
