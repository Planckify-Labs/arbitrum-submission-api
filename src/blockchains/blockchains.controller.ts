import {
  Controller,
  Get,
  Post,
  Body,
  Put,
  Param,
  Delete,
  HttpCode,
  HttpStatus,
  Query,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { BlockchainsService } from "./blockchains.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import {
  ApiCreateBlockchain,
  ApiDeleteBlockchain,
  ApiUpdateBlockchain,
  ApiGetBlockchainsPublic,
  ApiSearchBlockchainsPublic,
  ApiGetBlockchainPublic,
} from "../decorators/swagger/blockchain.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";

@Controller("blockchains")
@ApiTags("blockchains")
export class BlockchainsController {
  constructor(private readonly blockchainsService: BlockchainsService) {}

  @Post()
  @ApiCreateBlockchain()
  create(@Body() createBlockchainDto: CreateBlockchainDto) {
    return this.blockchainsService.create(createBlockchainDto);
  }

  @Get()
  @Public()
  @ApiKey()
  @ApiGetBlockchainsPublic()
  findAll(@Query() paginationDto: CursorPaginationDto) {
    return this.blockchainsService.findAll(paginationDto);
  }

  @Get("search")
  @Public()
  @ApiKey()
  @ApiSearchBlockchainsPublic()
  search(
    @Query() searchParams: SearchBlockchainDto,
    @Query() paginationDto: CursorPaginationDto,
  ) {
    return this.blockchainsService.search(searchParams, paginationDto);
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetBlockchainPublic()
  findOne(@Param("id") id: string) {
    return this.blockchainsService.findOne(id);
  }

  @Put(":id")
  @ApiUpdateBlockchain()
  update(
    @Param("id") id: string,
    @Body() updateBlockchainDto: UpdateBlockchainDto,
  ) {
    return this.blockchainsService.update(id, updateBlockchainDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiDeleteBlockchain()
  remove(@Param("id") id: string) {
    return this.blockchainsService.remove(id);
  }
}
