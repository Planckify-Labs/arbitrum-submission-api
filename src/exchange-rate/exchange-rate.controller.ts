import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Query,
  Param,
  BadRequestException,
  HttpCode,
  HttpStatus,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExchangeRateService } from "./exchange-rate.service";
import {
  CreateExchangeRateDto,
  QueryExchangeRateDto,
  GetLatestExchangeRateDto,
} from "./dto/exchange-rate.dto";
import {
  CreateExchangeSourceDto,
  UpdateExchangeSourceDto,
} from "./dto/exchange-source.dto";
import {
  ApiCreateExchangeRate,
  ApiGetLatestExchangeRate,
  ApiGetAllExchangeRates,
  ApiGetAverageExchangeRate,
  ApiGetExchangeRatePublic,
} from "../decorators/swagger/exchange-rate.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";
import { Roles } from "../decorators/roles.decorator";
import { UserRole } from "@generated/prisma";

@ApiTags("Exchange Rates")
@Controller("exchange-rates")
export class ExchangeRateController {
  constructor(private readonly exchangeRateService: ExchangeRateService) {}

  @Post()
  @ApiCreateExchangeRate()
  async create(@Body() createDto: CreateExchangeRateDto) {
    return await this.exchangeRateService.create(createDto);
  }

  @Get("latest")
  @Public()
  @ApiKey()
  @ApiGetLatestExchangeRate()
  async getLatest(@Query() query: GetLatestExchangeRateDto) {
    return await this.exchangeRateService.findLatest(query);
  }

  @Get()
  @ApiGetAllExchangeRates()
  async findAll(@Query() query: QueryExchangeRateDto) {
    console.log("Finding all exchange rates with query:", query);
    if (query.take) {
      query.take = Number(query.take);
    }
    return await this.exchangeRateService.findAll(query);
  }

  @Get("average")
  @ApiGetAverageExchangeRate()
  async getAverage(@Query() query: QueryExchangeRateDto) {
    console.log("Getting average exchange rate with query:", query);
    return await this.exchangeRateService.getAverageRate(query);
  }

  @Get("sources")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async findAllSources() {
    return this.exchangeRateService.findAllSources();
  }

  @Get("sources/:id")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async findSourceById(@Param("id") id: string) {
    return this.exchangeRateService.findSourceById(id);
  }

  @Post("sources")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async createSource(@Body() dto: CreateExchangeSourceDto) {
    return this.exchangeRateService.createSource(dto);
  }

  @Patch("sources/:id")
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async updateSource(
    @Param("id") id: string,
    @Body() dto: UpdateExchangeSourceDto,
  ) {
    return this.exchangeRateService.updateSource(id, dto);
  }

  @Delete("sources/:id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  async deleteSource(@Param("id") id: string) {
    return this.exchangeRateService.deleteSource(id);
  }

  @Get(":id")
  @Public()
  @ApiKey()
  @ApiGetExchangeRatePublic()
  async findOne(@Param("id") id: string) {
    const exchangeRateId = parseInt(id, 10);
    if (isNaN(exchangeRateId)) {
      throw new BadRequestException("Invalid exchange rate ID");
    }
    return await this.exchangeRateService.findOne(exchangeRateId);
  }
}
