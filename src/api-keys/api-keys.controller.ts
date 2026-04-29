import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  Query,
  UseGuards,
  Request,
  HttpCode,
  HttpStatus,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from "@nestjs/swagger";

interface AuthenticatedRequest {
  user?: {
    id: string;
    walletAddress: string;
  };
}
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";
import { SearchApiKeyDto } from "./dto/search-api-key.dto";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import { CursorPaginationDto } from "src/dto/common/pagination.dto";

@Controller("api-keys")
@ApiTags("api-keys")
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Post()
  @ApiOperation({ summary: "Create a new API key" })
  @ApiResponse({
    status: 201,
    description: "API key created successfully",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        description: { type: "string" },
        keyValue: {
          type: "string",
          description: "Full API key value (only shown on creation)",
        },
        type: {
          type: "string",
          enum: [
            "SMART_CONTRACT",
            "MOBILE_APP",
            "WEB_APP",
            "THIRD_PARTY",
            "INTERNAL",
            "ADMIN",
          ],
        },
        status: {
          type: "string",
          enum: ["ACTIVE", "INACTIVE", "REVOKED", "EXPIRED"],
        },
        permissions: { type: "array", items: { type: "string" } },
        rateLimit: { type: "number" },
        expiresAt: { type: "string", format: "date-time" },
        lastUsedAt: { type: "string", format: "date-time" },
        usageCount: { type: "number" },
        metadata: { type: "object" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        createdBy: {
          type: "object",
          properties: {
            id: { type: "string" },
            name: { type: "string" },
            email: { type: "string" },
          },
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: "Bad request" })
  @ApiResponse({ status: 409, description: "API key name already exists" })
  create(
    @Body() createApiKeyDto: CreateApiKeyDto,
    @Request() req: AuthenticatedRequest,
  ) {
    return this.apiKeysService.create(createApiKeyDto, req.user?.id);
  }

  @Get()
  @ApiOperation({ summary: "Get all API keys with pagination" })
  @ApiResponse({
    status: 200,
    description: "List of API keys",
    schema: {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              name: { type: "string" },
              description: { type: "string" },
              keyValue: { type: "string", description: "Masked API key value" },
              type: { type: "string" },
              status: { type: "string" },
              permissions: { type: "array", items: { type: "string" } },
              rateLimit: { type: "number" },
              expiresAt: { type: "string", format: "date-time" },
              lastUsedAt: { type: "string", format: "date-time" },
              usageCount: { type: "number" },
              metadata: { type: "object" },
              createdAt: { type: "string", format: "date-time" },
              updatedAt: { type: "string", format: "date-time" },
              createdBy: { type: "object" },
            },
          },
        },
        hasNextPage: { type: "boolean" },
        nextCursor: { type: "string" },
      },
    },
  })
  async findAll(
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.apiKeysService.findAll(paginationDto);
    res.setHeader("X-Total-Count", String(result.total));
    return result;
  }

  @Get("search")
  @ApiOperation({ summary: "Search API keys with filters" })
  @ApiResponse({
    status: 200,
    description: "Filtered list of API keys",
  })
  async search(
    @Query() searchDto: SearchApiKeyDto,
    @Query() paginationDto: CursorPaginationDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.apiKeysService.search(searchDto, paginationDto);
    res.setHeader("X-Total-Count", String(result.total));
    return result;
  }

  @Get(":id")
  @ApiOperation({ summary: "Get API key by ID" })
  @ApiResponse({
    status: 200,
    description: "API key details",
  })
  @ApiResponse({ status: 404, description: "API key not found" })
  findOne(@Param("id") id: string) {
    return this.apiKeysService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update API key" })
  @ApiResponse({
    status: 200,
    description: "API key updated successfully",
  })
  @ApiResponse({ status: 404, description: "API key not found" })
  @ApiResponse({ status: 409, description: "API key name already exists" })
  update(@Param("id") id: string, @Body() updateApiKeyDto: UpdateApiKeyDto) {
    return this.apiKeysService.update(id, updateApiKeyDto);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete API key" })
  @ApiResponse({
    status: 204,
    description: "API key deleted successfully",
  })
  @ApiResponse({ status: 404, description: "API key not found" })
  remove(@Param("id") id: string) {
    return this.apiKeysService.remove(id);
  }

  @Patch(":id/revoke")
  @ApiOperation({ summary: "Revoke API key" })
  @ApiResponse({
    status: 200,
    description: "API key revoked successfully",
  })
  @ApiResponse({ status: 404, description: "API key not found" })
  revoke(@Param("id") id: string) {
    return this.apiKeysService.revokeApiKey(id);
  }

  @Post(":id/regenerate")
  @ApiOperation({ summary: "Regenerate API key" })
  @ApiResponse({
    status: 200,
    description: "API key regenerated successfully",
    schema: {
      type: "object",
      properties: {
        id: { type: "string" },
        name: { type: "string" },
        keyValue: {
          type: "string",
          description: "New API key value (only shown on regeneration)",
        },
        type: { type: "string" },
        status: { type: "string" },
        permissions: { type: "array", items: { type: "string" } },
        rateLimit: { type: "number" },
        expiresAt: { type: "string", format: "date-time" },
        lastUsedAt: { type: "string", format: "date-time" },
        usageCount: { type: "number" },
        metadata: { type: "object" },
        createdAt: { type: "string", format: "date-time" },
        updatedAt: { type: "string", format: "date-time" },
        createdBy: { type: "object" },
      },
    },
  })
  @ApiResponse({ status: 404, description: "API key not found" })
  regenerate(@Param("id") id: string) {
    return this.apiKeysService.regenerateApiKey(id);
  }
}
