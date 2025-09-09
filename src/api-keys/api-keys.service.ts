import {
  Injectable,
  NotFoundException,
  ConflictException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { VendorAPICacheService } from "../valkey/services/vendor-api-cache.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";
import { UpdateApiKeyDto } from "./dto/update-api-key.dto";
import { SearchApiKeyDto } from "./dto/search-api-key.dto";
import * as crypto from "crypto";
import { ApiKeyStatus, ApiKey, Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "src/dto/common/pagination.dto";

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly vendorAPICacheService: VendorAPICacheService,
  ) { }

  async create(createApiKeyDto: CreateApiKeyDto, createdById?: string) {
    const keyValue = this.generateApiKey();

    const existingKey = await this.prisma.apiKey.findFirst({
      where: { name: createApiKeyDto.name },
    });

    if (existingKey) {
      throw new ConflictException("API key with this name already exists");
    }

    const apiKey = await this.prisma.apiKey.create({
      data: {
        name: createApiKeyDto.name,
        description: createApiKeyDto.description,
        keyValue,
        type: createApiKeyDto.type,
        permissions: createApiKeyDto.permissions || [],
        rateLimit: createApiKeyDto.rateLimit,
        expiresAt: createApiKeyDto.expiresAt
          ? new Date(createApiKeyDto.expiresAt)
          : null,
        metadata: (createApiKeyDto.metadata || {}) as Prisma.JsonObject,
        createdById,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      ...apiKey,
      keyValue: keyValue,
    };
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { take = 10, cursor } = paginationDto;

    const apiKeys = await this.prisma.apiKey.findMany({
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const hasNextPage = apiKeys.length > take;
    const items = hasNextPage ? apiKeys.slice(0, -1) : apiKeys;

    return {
      items: items.map(this.sanitizeApiKey),
      hasNextPage,
      nextCursor: hasNextPage ? items[items.length - 1].id : null,
    };
  }

  async search(searchDto: SearchApiKeyDto, paginationDto: CursorPaginationDto) {
    const { take = 10, cursor } = paginationDto;
    const {
      name,
      type,
      status,
      createdFrom,
      createdTo,
      expiresFrom,
      expiresTo,
    } = searchDto;

    const where: Prisma.ApiKeyWhereInput = {};

    if (name) {
      where.name = { contains: name, mode: "insensitive" };
    }

    if (type) {
      where.type = type;
    }

    if (status) {
      where.status = status;
    }

    if (createdFrom || createdTo) {
      where.createdAt = {};
      if (createdFrom) where.createdAt.gte = new Date(createdFrom);
      if (createdTo) where.createdAt.lte = new Date(createdTo);
    }

    if (expiresFrom || expiresTo) {
      where.expiresAt = {};
      if (expiresFrom) where.expiresAt.gte = new Date(expiresFrom);
      if (expiresTo) where.expiresAt.lte = new Date(expiresTo);
    }

    const apiKeys = await this.prisma.apiKey.findMany({
      where,
      take: take + 1,
      cursor: cursor ? { id: cursor } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const hasNextPage = apiKeys.length > take;
    const items = hasNextPage ? apiKeys.slice(0, -1) : apiKeys;

    return {
      items: items.map(this.sanitizeApiKey),
      hasNextPage,
      nextCursor: hasNextPage ? items[items.length - 1].id : null,
    };
  }

  async findOne(id: string) {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { id },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!apiKey) {
      throw new NotFoundException("API key not found");
    }

    return this.sanitizeApiKey(apiKey);
  }

  async update(id: string, updateApiKeyDto: UpdateApiKeyDto) {
    const existingKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existingKey) {
      throw new NotFoundException("API key not found");
    }

    if (updateApiKeyDto.name) {
      const nameExists = await this.prisma.apiKey.findFirst({
        where: {
          name: updateApiKeyDto.name,
          id: { not: id },
        },
      });

      if (nameExists) {
        throw new ConflictException("API key with this name already exists");
      }
    }

    const updatedApiKey = await this.prisma.apiKey.update({
      where: { id },
      data: {
        name: updateApiKeyDto.name,
        description: updateApiKeyDto.description,
        type: updateApiKeyDto.type,
        status: updateApiKeyDto.status,
        permissions: updateApiKeyDto.permissions,
        rateLimit: updateApiKeyDto.rateLimit,
        expiresAt: updateApiKeyDto.expiresAt
          ? new Date(updateApiKeyDto.expiresAt)
          : undefined,
        metadata: updateApiKeyDto.metadata as Prisma.JsonObject,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.sanitizeApiKey(updatedApiKey);
  }

  async remove(id: string) {
    const existingKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existingKey) {
      throw new NotFoundException("API key not found");
    }

    await this.prisma.apiKey.delete({
      where: { id },
    });

    return { message: "API key deleted successfully" };
  }

  async revokeApiKey(id: string) {
    const existingKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existingKey) {
      throw new NotFoundException("API key not found");
    }

    const updatedApiKey = await this.prisma.apiKey.update({
      where: { id },
      data: { status: ApiKeyStatus.REVOKED },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return this.sanitizeApiKey(updatedApiKey);
  }

  async regenerateApiKey(id: string) {
    const existingKey = await this.prisma.apiKey.findUnique({
      where: { id },
    });

    if (!existingKey) {
      throw new NotFoundException("API key not found");
    }

    const newKeyValue = this.generateApiKey();

    const updatedApiKey = await this.prisma.apiKey.update({
      where: { id },
      data: {
        keyValue: newKeyValue,
        status: ApiKeyStatus.ACTIVE,
        lastUsedAt: null,
        usageCount: 0,
      },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    return {
      ...this.sanitizeApiKey(updatedApiKey),
      keyValue: newKeyValue,
    };
  }

  async validateApiKey(keyValue: string): Promise<ApiKey | null> {
    const apiKey = await this.prisma.apiKey.findUnique({
      where: { keyValue },
      include: {
        createdBy: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!apiKey) {
      return null;
    }

    if (apiKey.status !== ApiKeyStatus.ACTIVE) {
      return null;
    }

    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      await this.prisma.apiKey.update({
        where: { id: apiKey.id },
        data: { status: ApiKeyStatus.EXPIRED },
      });
      return null;
    }

    await this.prisma.apiKey.update({
      where: { id: apiKey.id },
      data: {
        lastUsedAt: new Date(),
        usageCount: { increment: 1 },
      },
    });

    if (apiKey.metadata && typeof apiKey.metadata === 'object') {
      const metadata = apiKey.metadata as any;
      if (metadata.vendorId) {
        try {
          await this.vendorAPICacheService.invalidateVendorAPICache(metadata.vendorId);
          await this.vendorAPICacheService.getVendorAPI(metadata.vendorId);
        } catch (error) {
          console.warn(`Failed to update vendor cache for vendor ${metadata.vendorId}:`, error);
        }
      }
    }

    return apiKey;
  }

  private generateApiKey(): string {
    const prefix = "tk_";
    const randomBytes = crypto.randomBytes(32).toString("hex");
    return `${prefix}${randomBytes}`;
  }

  private sanitizeApiKey(
    apiKey: ApiKey & {
      createdBy?: {
        id: string;
        name: string | null;
        email: string | null;
      } | null;
    },
  ) {
    const maskedKeyValue = apiKey.keyValue
      ? `${apiKey.keyValue.substring(0, 8)}...${apiKey.keyValue.substring(apiKey.keyValue.length - 4)}`
      : null;

    return {
      ...apiKey,
      keyValue: maskedKeyValue,
    };
  }
}
