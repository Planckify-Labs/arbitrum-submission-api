import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  Param,
  BadRequestException,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ExchangeRateService } from "./exchange-rate.service";
import {
  CreateExchangeRateDto,
  QueryExchangeRateDto,
  GetLatestExchangeRateDto,
} from "./dto/exchange-rate.dto";
import {
  ApiCreateExchangeRate,
  ApiGetLatestExchangeRate,
  ApiGetAllExchangeRates,
  ApiGetAverageExchangeRate,
  ApiGetExchangeRatePublic,
} from "../decorators/swagger/exchange-rate.decorators";
import { Public } from "../decorators/public.decorator";
import { ApiKey } from "../decorators/api-key.decorator";

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
