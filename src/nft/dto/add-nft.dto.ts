import { IsString, IsInt, IsNotEmpty, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddNftDto {
  @ApiProperty({ example: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' })
  @IsString()
  @IsNotEmpty()
  contractAddress: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @ApiProperty({ example: 1, description: 'Chain ID (e.g. 1 for Ethereum mainnet)' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  chainId: number;
}
