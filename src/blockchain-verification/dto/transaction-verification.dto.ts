import {
  IsString,
  IsOptional,
  IsNumber,
  Min,
  IsEthereumAddress,
} from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class VerifyTransactionDto {
  @ApiProperty({
    description: "Transaction hash to verify",
    example:
      "0x4ca7ee652d57678f26e887c149ab0735f41de37bcad58c9f6d3ed5824f15b74d",
  })
  @IsString()
  transactionHash: string;

  @ApiProperty({
    description: "Expected sender wallet address",
    example: "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
  })
  @IsEthereumAddress()
  expectedSender: string;

  @ApiProperty({
    description: "Expected recipient address (smart contract)",
    example: "0xe592427a0aece92de3edee1f18e0157c05861564",
  })
  @IsEthereumAddress()
  expectedRecipient: string;

  @ApiProperty({
    description: "Expected blockchain chain ID",
    example: 1,
  })
  @IsNumber()
  expectedChainId: number;

  @ApiPropertyOptional({
    description: "Minimum number of confirmations required",
    example: 12,
    default: 12,
  })
  @IsOptional()
  @IsNumber()
  @Min(1)
  minimumConfirmations?: number;
}

export class VerifyTransactionWithBookingDto {
  @ApiProperty({
    description: "Transaction hash to verify",
    example:
      "0x4ca7ee652d57678f26e887c149ab0735f41de37bcad58c9f6d3ed5824f15b74d",
  })
  @IsString()
  transactionHash: string;

  @ApiProperty({
    description: "Booking ID to validate against",
    example: "booking-uuid-123",
  })
  @IsString()
  bookingId: string;
}

export class TransactionVerificationResponseDto {
  @ApiProperty({
    description: "Whether the transaction is valid",
    example: true,
  })
  isValid: boolean;

  @ApiProperty({
    description: "Transaction hash",
    example:
      "0x4ca7ee652d57678f26e887c149ab0735f41de37bcad58c9f6d3ed5824f15b74d",
  })
  transactionHash: string;

  @ApiProperty({
    description: "Block number where transaction was mined",
    example: "12420978",
  })
  blockNumber: string;

  @ApiProperty({
    description: "Number of confirmations",
    example: 15,
  })
  confirmations: number;

  @ApiProperty({
    description: "Sender address",
    example: "0xab5801a7d398351b8be11c439e05c5b3259aec9b",
  })
  from: string;

  @ApiProperty({
    description: "Recipient address",
    example: "0xe592427a0aece92de3edee1f18e0157c05861564",
  })
  to: string;

  @ApiProperty({
    description: "Transaction value in wei",
    example: "1000000000000000000",
  })
  value: string;

  @ApiProperty({
    description: "Transaction status",
    example: "success",
    enum: ["success", "reverted"],
  })
  status: "success" | "reverted";

  @ApiProperty({
    description: "Gas used by the transaction",
    example: "329945",
  })
  gasUsed: string;

  @ApiProperty({
    description: "Block timestamp",
    example: "1621234567",
  })
  blockTimestamp: string;

  @ApiProperty({
    description: "Chain ID",
    example: 1,
  })
  chainId: number;
}
