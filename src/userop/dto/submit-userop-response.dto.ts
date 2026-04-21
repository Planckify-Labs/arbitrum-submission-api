import { ApiProperty } from "@nestjs/swagger";

/**
 * Response body for `POST /v1/userop/submit` (task 37, spec §6.7
 * `UserOpSubmitResponse`).
 *
 * The canonical success shape is the bundler's own: a 32-byte userOp hash.
 * Mobile (task 35 adapter) uses the hash to poll `eth_getUserOperationReceipt`
 * or — more commonly — to correlate the subsequent deposit-receipt call
 * (task 38).
 */
export class SubmitUserOpResponseDto {
  @ApiProperty({
    description:
      "32-byte userOp hash returned by the bundler. Computed as keccak256 " +
      "of the packed userOp + entryPoint + chainId.",
    example: "0x" + "aa".repeat(32),
  })
  userOpHash!: `0x${string}`;

  @ApiProperty({
    description: "Chain id the UserOp was submitted on (echo of the request).",
    example: 84532,
  })
  chainId!: number;
}
