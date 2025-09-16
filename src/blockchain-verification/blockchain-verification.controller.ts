import { Controller, Post, Body, Get, Param, Query } from "@nestjs/common";
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiQuery,
} from "@nestjs/swagger";
import { BlockchainVerificationService } from "./blockchain-verification.service";
import {
  VerifyTransactionDto,
  TransactionVerificationResponseDto,
} from "./dto/transaction-verification.dto";

@ApiTags("Blockchain Verification")
@Controller("blockchain-verification")
export class BlockchainVerificationController {
  constructor(
    private readonly blockchainVerificationService: BlockchainVerificationService,
  ) {}

  @Post("verify-transaction")
  @ApiOperation({
    summary: "Verify a blockchain transaction",
    description:
      "Verifies a blockchain transaction with specified parameters including confirmations, sender, and recipient validation.",
  })
  @ApiResponse({
    status: 200,
    description: "Transaction verification result",
    type: TransactionVerificationResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: "Invalid transaction or verification failed",
  })
  async verifyTransaction(
    @Body() verifyTransactionDto: VerifyTransactionDto,
  ): Promise<TransactionVerificationResponseDto> {
    return await this.blockchainVerificationService.verifyTransaction(
      verifyTransactionDto,
    );
  }

  @Get("transaction/:hash/confirmations")
  @ApiOperation({
    summary: "Get transaction confirmation count",
    description:
      "Returns the current number of confirmations for a transaction on the specified chain.",
  })
  @ApiParam({
    name: "hash",
    description: "Transaction hash",
    example:
      "0x4ca7ee652d57678f26e887c149ab0735f41de37bcad58c9f6d3ed5824f15b74d",
  })
  @ApiQuery({
    name: "chainId",
    description: "Blockchain chain ID",
    example: 1,
    type: Number,
  })
  @ApiResponse({
    status: 200,
    description: "Number of confirmations",
    schema: {
      type: "object",
      properties: {
        transactionHash: { type: "string" },
        chainId: { type: "number" },
        confirmations: { type: "number" },
      },
    },
  })
  async getTransactionConfirmations(
    @Param("hash") hash: string,
    @Query("chainId") chainId: number,
  ) {
    const confirmations =
      await this.blockchainVerificationService.getTransactionConfirmations(
        hash,
        Number(chainId),
      );

    return {
      transactionHash: hash,
      chainId: Number(chainId),
      confirmations,
    };
  }

  @Get("transaction/:hash/confirmed")
  @ApiOperation({
    summary: "Check if transaction is confirmed",
    description:
      "Checks if a transaction has the minimum required confirmations and is successful.",
  })
  @ApiParam({
    name: "hash",
    description: "Transaction hash",
    example:
      "0x4ca7ee652d57678f26e887c149ab0735f41de37bcad58c9f6d3ed5824f15b74d",
  })
  @ApiQuery({
    name: "chainId",
    description: "Blockchain chain ID",
    example: 1,
    type: Number,
  })
  @ApiQuery({
    name: "minConfirmations",
    description: "Minimum confirmations required (default: 12)",
    example: 12,
    type: Number,
    required: false,
  })
  @ApiResponse({
    status: 200,
    description: "Transaction confirmation status",
    schema: {
      type: "object",
      properties: {
        transactionHash: { type: "string" },
        chainId: { type: "number" },
        isConfirmed: { type: "boolean" },
        minConfirmations: { type: "number" },
      },
    },
  })
  async isTransactionConfirmed(
    @Param("hash") hash: string,
    @Query("chainId") chainId: number,
    @Query("minConfirmations") minConfirmations?: number,
  ) {
    const isConfirmed =
      await this.blockchainVerificationService.isTransactionConfirmed(
        hash,
        Number(chainId),
        minConfirmations ? Number(minConfirmations) : 12,
      );

    return {
      transactionHash: hash,
      chainId: Number(chainId),
      isConfirmed,
      minConfirmations: minConfirmations ? Number(minConfirmations) : 12,
    };
  }
}
