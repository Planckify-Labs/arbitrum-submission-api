import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNftDto {
  @ApiProperty({ example: '0xbc4ca0eda7647a8ab7c2061c2e118a18a936f13d' })
  @IsString()
  @IsNotEmpty()
  contractAddress: string;

  @ApiProperty({ example: '1234' })
  @IsString()
  @IsNotEmpty()
  tokenId: string;

  @ApiProperty({
    example: '01JABC123...',
    description: 'Blockchain record id (FK to Blockchain.id)',
  })
  @IsString()
  @IsNotEmpty()
  blockchainId: string;
}
