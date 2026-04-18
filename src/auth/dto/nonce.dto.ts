import { ApiProperty } from "@nestjs/swagger";
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateIf,
  registerDecorator,
  ValidationOptions,
  ValidationArguments,
} from "class-validator";
import { Type } from "class-transformer";

function ExclusiveWith(other: string, validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: "exclusiveWith",
      target: object.constructor,
      propertyName,
      constraints: [other],
      options: {
        message: `${propertyName} and ${other} are mutually exclusive`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const [otherProp] = args.constraints as [string];
          const otherValue = (args.object as Record<string, unknown>)[otherProp];
          if (value === undefined || value === null) return true;
          return otherValue === undefined || otherValue === null;
        },
      },
    });
  };
}

export class NonceDto {
  @ApiProperty({
    description:
      "The EVM chain ID (e.g., 1 for Ethereum Mainnet). Mutually exclusive with chainSlug.",
    required: false,
    default: 1,
    type: Number,
  })
  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @ExclusiveWith("chainSlug")
  chainId?: number;

  @ApiProperty({
    description:
      'Non-EVM chain slug (e.g., "solana-mainnet", "solana-devnet"). Mutually exclusive with chainId.',
    required: false,
    type: String,
    examples: ["solana-mainnet", "solana-devnet"],
  })
  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9]+(-[a-z0-9]+)*$/, {
    message:
      "chainSlug must be lowercase kebab-case (e.g., solana-mainnet)",
  })
  @ValidateIf((o) => o.chainSlug !== undefined)
  @ExclusiveWith("chainId")
  chainSlug?: string;
}
