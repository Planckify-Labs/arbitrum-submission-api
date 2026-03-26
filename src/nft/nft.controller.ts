import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Request,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { NftService } from './nft.service';
import { AddNftDto } from './dto/add-nft.dto';

interface AuthenticatedRequest {
  user: {
    id: string;
    walletAddress: string;
  };
}

@Controller('nft')
@ApiTags('nft')
@ApiBearerAuth()
export class NftController {
  constructor(private readonly nftService: NftService) {}

  @Post('assets')
  @ApiOperation({ summary: 'Add an NFT asset by contract address and token ID' })
  addAsset(
    @Body() dto: AddNftDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.nftService.addNftAsset(
      req.user.id,
      req.user.walletAddress,
      dto,
    );
  }

  @Get('assets')
  @ApiOperation({ summary: 'Get all owned NFT assets for the authenticated user' })
  getAssets(@Request() req: AuthenticatedRequest) {
    return this.nftService.getUserNftAssets(req.user.id);
  }

  @Patch('assets/:id/refresh')
  @ApiOperation({ summary: 'Re-fetch metadata and re-verify ownership for an NFT' })
  refreshAsset(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.nftService.refreshNftAsset(req.user.id, id);
  }

  @Delete('assets/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove an NFT asset from the wallet' })
  removeAsset(
    @Param('id') id: string,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.nftService.removeNftAsset(req.user.id, id);
  }
}
