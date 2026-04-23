import { IsString, IsOptional, IsNotEmpty, IsArray } from "class-validator";
import { ApiProperty } from "@nestjs/swagger";
import { PartialType } from "@nestjs/swagger";

export class CreateContractAbiDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  description?: string;

  @ApiProperty({ required: false })
  @IsString()
  @IsOptional()
  version?: string;

  @ApiProperty({ description: "ABI JSON array" })
  @IsArray()
  abi: unknown[];
}

export class UpdateContractAbiDto extends PartialType(CreateContractAbiDto) {}
