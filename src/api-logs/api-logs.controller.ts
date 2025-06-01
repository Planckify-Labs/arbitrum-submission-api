import { Controller, Get, Param, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ApiLogsService } from "./api-logs.service";
import { SearchApiLogDto } from "./dto/api-log.dto";
import {
  ApiGetLogs,
  ApiSearchLogs,
  ApiGetLogByRequestId,
  ApiGetUserLogs,
  ApiGetPurchaseLogs,
} from "../decorators/swagger/api-log.decorators";

@Controller("api-logs")
@ApiTags("api-logs")
export class ApiLogsController {
  constructor(private readonly apiLogsService: ApiLogsService) {}

  @Get()
  @ApiGetLogs()
  findAll() {
    return this.apiLogsService.findAll();
  }

  @Get("search")
  @ApiSearchLogs()
  search(@Query() searchParams: SearchApiLogDto) {
    return this.apiLogsService.search(searchParams);
  }

  @Get("request/:requestId")
  @ApiGetLogByRequestId()
  findByRequestId(@Param("requestId") requestId: string) {
    return this.apiLogsService.findByRequestId(requestId);
  }

  @Get("user/:userId")
  @ApiGetUserLogs()
  findByUser(@Param("userId") userId: string) {
    return this.apiLogsService.findByUser(userId);
  }

  @Get("purchase/:purchaseId")
  @ApiGetPurchaseLogs()
  findByPurchase(@Param("purchaseId") purchaseId: string) {
    return this.apiLogsService.findByPurchase(purchaseId);
  }
}
