import { IsString, IsNotEmpty, IsOptional } from "class-validator";
import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";

export class ExecuteRedeemDto {
  @ApiProperty({ description: "Product variant ID" })
  @IsString()
  @IsNotEmpty()
  productVariantId: string;

  @ApiProperty({ description: "Product price ID" })
  @IsString()
  @IsNotEmpty()
  productPriceId: string;

  @ApiPropertyOptional({ description: "Customer info required by the product" })
  @IsOptional()
  customerInfo?:
    | Record<string, unknown>
    | Array<{ key: string; value: string }>;
}
