import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from "class-validator";

/**
 * Body for `POST /v1/userop/submit` (task 37, spec §6.7).
 *
 * The mobile app signs an ERC-4337 UserOperation (v0.7 packed shape per
 * viem/permissionless) locally via `sendUserOpWithUsdcPaymaster` (§5.5, task
 * 35) and POSTs it here. We forward the payload verbatim to the configured
 * bundler for `chainId` — the signature was computed over exact byte layout,
 * so any mutation here would invalidate it.
 *
 * Three-role separation (memory `feedback_role_separation.md`): we DO NOT
 * re-sign, re-build, or otherwise reshape the UserOp. The mobile signs, the
 * server relays, the bundler executes. The server's only contribution is the
 * bundler URL + API key held in env (kept off-device — §10 rule).
 */
export class SubmitUserOpDto {
  /**
   * Target chain id. Used server-side to resolve the bundler URL from the
   * `Blockchain.bundlerUrl` column for this chain (see userop.service.ts).
   * Unknown / unconfigured chains are rejected with 400 `CHAIN_NOT_SUPPORTED`.
   */
  @ApiProperty({
    description:
      "Target EVM chainId. Backend maps this to a configured bundler URL " +
      "(Alchemy / Pimlico / Stackup). Unsupported chainIds are rejected 400.",
    example: 84532,
  })
  @IsInt()
  @Min(1)
  chainId!: number;

  /**
   * The signed ERC-4337 PackedUserOperation (viem v0.7 shape). We accept it
   * as an opaque object — validating every field server-side buys nothing
   * (the bundler already does full EntryPoint simulation) and mutating any
   * field would invalidate the signature the mobile computed. See §6.7 in
   * the spec for the canonical field set.
   */
  @ApiProperty({
    description:
      "Signed PackedUserOperation v0.7. Forwarded verbatim to the bundler. " +
      "Server never modifies the object — doing so would invalidate the " +
      "mobile-computed signature.",
  })
  @IsObject()
  userOp!: Record<string, unknown>;

  /**
   * The EntryPoint contract the UserOp targets. Included in the JSON-RPC
   * params (bundlers require it). We validate shape only — the bundler
   * rejects wrong-EntryPoint submissions with its own error surface which
   * we forward verbatim.
   */
  @ApiProperty({
    description:
      "ERC-4337 EntryPoint contract address (v0.7 canonical: 0x0000000071727De22E5E9d8BAf0edAc6f37da032).",
    example: "0x0000000071727De22E5E9d8BAf0edAc6f37da032",
  })
  @IsString()
  @Matches(/^0x[0-9a-fA-F]{40}$/, {
    message: "entryPoint must be a 20-byte EVM address (`0x` + 40 hex).",
  })
  entryPoint!: `0x${string}`;

  /**
   * Optional intent id — if the UserOp is the Gateway-deposit half of a
   * scan-to-pay flow, we'll log it alongside the (sender, entryPoint,
   * chainId) triple. Purely observational: never forwarded to the bundler,
   * never trusted as authorization.
   */
  @ApiPropertyOptional({
    description:
      "Optional payment-intent id for audit correlation. Not forwarded to the bundler.",
    example: "pi_01HXYZ",
  })
  @IsOptional()
  @IsString()
  intentId?: string;
}
