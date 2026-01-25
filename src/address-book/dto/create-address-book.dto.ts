import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsOptional, IsBoolean } from 'class-validator';

export class CreateAddressBookDto {
  @ApiProperty({ description: 'Label for the address (e.g. "My Wallet")' })
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiProperty({ description: 'Wallet address' })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiPropertyOptional({ description: 'ENS name associated with the address' })
  @IsString()
  @IsOptional()
  ensName?: string;

  @ApiPropertyOptional({ description: 'Optional notes about the address' })
  @IsString()
  @IsOptional()
  notes?: string;

  @ApiPropertyOptional({ description: 'Whether the address is an EVM address', default: true })
  @IsBoolean()
  @IsOptional()
  isEvm?: boolean;

  @ApiPropertyOptional({ description: 'Chain name (e.g. "Ethereum", "Polygon")' })
  @IsString()
  @IsOptional()
  chainName?: string;
}
