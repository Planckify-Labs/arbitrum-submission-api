import { ApiProperty } from "@nestjs/swagger";

/**
 * Enriched `GET /blockchains` response shape.
 *
 * Spec ref: umkm-usdc-payout-spec.md §6.7 (chain-config as data), task 21.
 *
 * This DTO is **additive** over the legacy {@link BlockchainResponseDto} — every
 * field the old shape exposed is still present here. The three new objects
 * (`gateway`, `paymaster`, `x402`) plus `usdc` plus `nativeCurrency` are net
 * additions that mobile's `useBlockchains()` hook consumes to build EIP-3009
 * typed-data, look up Circle's GatewayWallet, discover the paymaster, and know
 * which token address is USDC on each chain.
 *
 * Nested-nullable discipline: if ALL columns that make up a nested object are
 * null in the DB, the object itself is `null` on the wire — NOT
 * `{ walletContract: null, minterContract: null }`. This matches the mobile
 * contract (§6.7: `gateway: { … } | null`).
 */

export class GatewayContractsDto {
  @ApiProperty({
    description:
      "Circle GatewayWallet contract address on this chain. Source chain for batched deposits.",
    example: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  })
  walletContract: string;

  @ApiProperty({
    description:
      "Circle GatewayMinter contract address on this chain. Destination chain for attested mints.",
    example: "0x0022222ABE238Cc2C7Bb1f21003F0a260052475B",
  })
  minterContract: string;
}

export class PaymasterDto {
  @ApiProperty({
    description:
      "Circle Paymaster address on this chain. Null on chains without a Paymaster deployment (e.g. Arc — USDC is the native gas token).",
    example: "0x777777777EBA4688BDeF3E311b846F25870A19B9",
  })
  address: string;
}

export class X402DomainDto {
  @ApiProperty({
    description:
      'EIP-712 domain name for EIP-3009 signing (from Circle `GET /gateway/v1/x402/supported`). E.g. "GatewayWalletBatched".',
    example: "GatewayWalletBatched",
  })
  domainName: string;

  @ApiProperty({
    description: "EIP-712 domain version.",
    example: "1",
  })
  domainVersion: string;

  @ApiProperty({
    description:
      "EIP-712 `verifyingContract` — the GatewayWallet contract the mobile app signs against. NOT the USDC contract.",
    example: "0x0077777d7EBA4688BDeF3E311b846F25870A19B9",
  })
  verifyingContract: string;

  @ApiProperty({
    description:
      "Default x402 facilitator URL for Path C (raw x402 to non-Nanopayments merchants). Null when unknown / no recommendation.",
    example: "https://x402-facilitator.takumipay.dev",
    nullable: true,
    required: false,
  })
  facilitatorUrl: string | null;
}

export class NativeCurrencyDto {
  @ApiProperty({
    description: "Native-currency token symbol (e.g. ETH, USDC on Arc, SOL).",
    example: "USDC",
  })
  symbol: string;

  @ApiProperty({
    description: "Native-currency decimals (ERC-20 interface view on Arc).",
    example: 6,
  })
  decimals: number;

  @ApiProperty({
    description:
      "On-chain contract address for the native currency. Null when the native currency is a true native (e.g. ETH), non-null on USDC-as-gas chains like Arc.",
    example: "0x3600000000000000000000000000000000000000",
    nullable: true,
    required: false,
  })
  address: string | null;
}

export class UsdcTokenDto {
  @ApiProperty({
    description: "USDC contract address on this chain.",
    example: "0x3600000000000000000000000000000000000000",
  })
  address: string;

  @ApiProperty({
    description: "USDC decimals (6 on every Gateway-supported chain).",
    example: 6,
  })
  decimals: number;

  @ApiProperty({ description: "Token symbol.", example: "USDC" })
  symbol: string;

  @ApiProperty({
    description:
      "True when USDC is also the chain's native currency (Arc). Callers treat gas-payment paths differently.",
    example: true,
  })
  isNativeCurrency: boolean;
}

export class BlockchainTokenDto {
  @ApiProperty() id: string;
  @ApiProperty() name: string;
  @ApiProperty() symbol: string;
  @ApiProperty() decimals: number;
  @ApiProperty() blockchainId: string;
  @ApiProperty({ nullable: true, required: false }) contractAddress: string | null;
  @ApiProperty({ nullable: true, required: false }) logoUrl: string | null;
  @ApiProperty() isStablecoin: boolean;
  @ApiProperty() isNativeCurrency: boolean;
  @ApiProperty() isActive: boolean;
  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;
}

export class EnrichedBlockchainResponseDto {
  @ApiProperty({ description: "Internal blockchain row ID (ULID).", example: "01H1G5V..." })
  id: string;

  @ApiProperty({ description: "Human-readable chain name.", example: "Arc Testnet" })
  name: string;

  @ApiProperty({
    description: "EVM chain ID (CAIP-2 reference). Null for non-EVM rows (e.g. Solana).",
    example: 5042002,
    nullable: true,
    required: false,
  })
  chainId: number | null;

  @ApiProperty({
    description:
      "CAIP-2 chain identifier — `eip155:<chainId>` for EVM, `solana:<cluster>` for Solana.",
    example: "eip155:5042002",
    nullable: true,
    required: false,
  })
  caip2Id: string | null;

  @ApiProperty({
    description: "Public HTTPS RPC endpoint. No secrets.",
    example: "https://rpc.testnet.arc.network",
  })
  rpcUrl: string;

  @ApiProperty({ description: "Block-explorer base URL.", example: "https://testnet.arcscan.app" })
  blockExplorer: string;

  @ApiProperty({ description: "True for EVM-compatible chains.", example: true })
  isEVM: boolean;

  @ApiProperty({ description: "True when the chain is selectable by users.", example: true })
  isActive: boolean;

  @ApiProperty({ description: "True for testnets.", example: true })
  isTestnet: boolean;

  @ApiProperty({
    description: "Native currency metadata (symbol, decimals, optional address).",
    type: NativeCurrencyDto,
    nullable: true,
    required: false,
  })
  nativeCurrency: NativeCurrencyDto | null;

  @ApiProperty({
    description:
      "Circle Gateway contracts on this chain. Null on chains not covered by Gateway.",
    type: GatewayContractsDto,
    nullable: true,
    required: false,
  })
  gateway: GatewayContractsDto | null;

  @ApiProperty({
    description:
      "Circle Paymaster contract. Null on chains without a Paymaster deployment.",
    type: PaymasterDto,
    nullable: true,
    required: false,
  })
  paymaster: PaymasterDto | null;

  @ApiProperty({
    description:
      "EIP-712 x402 domain for EIP-3009 signing. Null on chains without an x402 scheme.",
    type: X402DomainDto,
    nullable: true,
    required: false,
  })
  x402: X402DomainDto | null;

  @ApiProperty({
    description:
      "USDC token row for this chain (from `tokens` WHERE `isStablecoin && symbol='USDC'`). Null when USDC isn't onboarded for this chain.",
    type: UsdcTokenDto,
    nullable: true,
    required: false,
  })
  usdc: UsdcTokenDto | null;

  @ApiProperty({
    description:
      "Included token rows (native currency + USDC stablecoin). Preserves backward compatibility with consumers that read `tokens[0]` for symbol/icon.",
    type: [BlockchainTokenDto],
    required: false,
  })
  tokens: BlockchainTokenDto[];

  @ApiProperty({ description: "Row-level updated timestamp (for ETag debugging).", example: "2024-03-19T12:00:00.000Z" })
  updatedAt: Date;
}
