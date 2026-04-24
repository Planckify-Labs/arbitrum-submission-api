import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type Address,
  type Hex,
  hashTypedData,
  recoverTypedDataAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export interface QuoteCommitment {
  refId: string;
  merchantId: string;
  tokenAddress: Address;
  amount: bigint;
  platformFeeAmount: bigint;
  fiatAmountMinor: bigint;
  fiatCurrency: Hex; // bytes3, e.g. "0x494452" for "IDR"
  exchangeRateId: bigint;
  expiresAt: bigint;
}

const QUOTE_COMMITMENT_TYPES = {
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
} as const;

@Injectable()
export class QuoteSignerService {
  private readonly logger = new Logger(QuoteSignerService.name);
  private readonly account;
  private readonly domainName: string;
  private readonly domainVersion: string;

  constructor(private readonly configService: ConfigService) {
    const privateKey = (this.configService.get<string>("QUOTE_SIGNER_PRIVATE_KEY") ??
      this.configService.get<string>("ADMIN_WALLET_PRIVATE_KEY")) as Hex;
    this.account = privateKeyToAccount(privateKey);
    this.domainName = this.configService.get("QUOTE_SIGNATURE_DOMAIN_NAME", "TakumiPay");
    this.domainVersion = this.configService.get("QUOTE_SIGNATURE_DOMAIN_VERSION", "1");
    this.logger.log(`QuoteSignerService initialized, signer address: ${this.account.address}`);
  }

  get signerAddress(): Address {
    return this.account.address;
  }

  async signQuote(
    commitment: QuoteCommitment,
    chainId: number,
    verifyingContract: Address,
  ): Promise<Hex> {
    const domain = {
      name: this.domainName,
      version: this.domainVersion,
      chainId: BigInt(chainId),
      verifyingContract,
    };

    const signature = await this.account.signTypedData({
      domain,
      types: QUOTE_COMMITMENT_TYPES,
      primaryType: "QuoteCommitment",
      message: commitment,
    });

    return signature;
  }
}
