import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ValkeyService } from '../valkey.service';
import { VendorAPICache } from '../interfaces/vendor-api-cache.interface';

@Injectable()
export class VendorAPICacheService {
  private readonly logger = new Logger(VendorAPICacheService.name);
  private readonly CACHE_PREFIX = 'vendorApi';

  constructor(
    private readonly valkeyService: ValkeyService,
    private readonly prismaService: PrismaService,
  ) { }

  private getCacheKey(vendorId: string): string {
    return `${this.CACHE_PREFIX}:${vendorId}`;
  }

  async getVendorAPI(vendorId: string): Promise<VendorAPICache | null> {
    const cacheKey = this.getCacheKey(vendorId);

    const cacheReady = await this.valkeyService.waitForConnection(5000);

    if (cacheReady) {
      try {
        const cachedData = await this.valkeyService.get<VendorAPICache>(cacheKey);

        if (cachedData) {
          this.logger.debug(`Cache hit for vendor API: ${vendorId}`);
          return cachedData;
        }

        this.logger.debug(`Cache miss for vendor API: ${vendorId}, fetching from database`);
      } catch (error) {
        this.logger.warn(`Cache unavailable for vendor API ${vendorId}, using database directly:`, error.message);
      }
    } else {
      this.logger.warn(`Cache unavailable for vendor API ${vendorId}, using database directly: Valkey connection not ready`);
    }

    try {
      const vendorAPI = await this.prismaService.vendorAPI.findFirst({
        where: {
          vendorId,
          isActive: true,
        },
        orderBy: {
          updatedAt: 'desc',
        },
      });

      if (!vendorAPI) {
        this.logger.warn(`No active vendor API found for vendor: ${vendorId}`);
        return null;
      }

      if (cacheReady) {
        try {
          await this.cacheVendorAPI(vendorId, vendorAPI);
        } catch {
          this.logger.debug(`Failed to cache vendor API for ${vendorId}, continuing without cache`);
        }
      }

      return vendorAPI;
    } catch (dbError) {
      this.logger.error(`Database query failed for vendor ${vendorId}:`, dbError);
      throw dbError;
    }
  }

  async cacheVendorAPI(vendorId: string, vendorAPI: VendorAPICache): Promise<void> {
    const cacheKey = this.getCacheKey(vendorId);

    const cacheReady = await this.valkeyService.waitForConnection(5000);

    if (!cacheReady) {
      this.logger.debug(`Skipping cache operation for ${vendorId}: Valkey connection not ready`);
      return;
    }

    try {
      await this.valkeyService.set(cacheKey, vendorAPI);
      this.logger.debug(`Cached vendor API data for vendor: ${vendorId} (no TTL)`);
    } catch (error) {
      this.logger.error(`Failed to cache vendor API for ${vendorId}:`, error);
    }
  }

  async invalidateVendorAPICache(vendorId: string): Promise<void> {
    const cacheKey = this.getCacheKey(vendorId);

    try {
      await this.valkeyService.del(cacheKey);
      this.logger.debug(`Invalidated cache for vendor: ${vendorId}`);
    } catch (error) {
      this.logger.error(`Failed to invalidate cache for vendor ${vendorId}:`, error);
    }
  }

  async getVendorAPICredentials(vendorId: string): Promise<{ baseUrl: string; apiKey: string; apiSecret: string | null } | null> {
    const vendorAPI = await this.getVendorAPI(vendorId);

    if (!vendorAPI) {
      return null;
    }

    return {
      baseUrl: vendorAPI.baseUrl,
      apiKey: vendorAPI.apiKey,
      apiSecret: vendorAPI.apiSecret,
    };
  }

  async updateVendorAPI(vendorId: string, updateData: Partial<Pick<VendorAPICache, 'baseUrl' | 'apiKey' | 'apiSecret' | 'isActive'>>): Promise<VendorAPICache> {
    try {
      const updatedVendorAPI = await this.prismaService.vendorAPI.updateMany({
        where: {
          vendorId,
        },
        data: {
          ...updateData,
          updatedAt: new Date(),
        },
      });

      if (updatedVendorAPI.count === 0) {
        throw new Error(`No vendor API found for vendor: ${vendorId}`);
      }

      await this.invalidateVendorAPICache(vendorId);

      const refreshedData = await this.getVendorAPI(vendorId);

      if (!refreshedData) {
        throw new Error(`Failed to fetch updated vendor API for: ${vendorId}`);
      }

      return refreshedData;
    } catch (error) {
      this.logger.error(`Failed to update vendor API for ${vendorId}:`, error);
      throw error;
    }
  }

  async createVendorAPI(vendorId: string, apiData: { baseUrl: string; apiKey: string; apiSecret?: string | null }): Promise<VendorAPICache> {
    try {
      const newVendorAPI = await this.prismaService.vendorAPI.create({
        data: {
          vendorId,
          baseUrl: apiData.baseUrl,
          apiKey: apiData.apiKey,
          apiSecret: apiData.apiSecret,
          isActive: true,
        },
      });

      await this.cacheVendorAPI(vendorId, newVendorAPI);

      return newVendorAPI;
    } catch (error) {
      this.logger.error(`Failed to create vendor API for ${vendorId}:`, error);
      throw error;
    }
  }

  async getMultipleVendorAPIs(vendorIds: string[]): Promise<Map<string, VendorAPICache | null>> {
    const result = new Map<string, VendorAPICache | null>();
    const cacheKeys = vendorIds.map(id => this.getCacheKey(id));

    try {
      const cachedValues = await this.valkeyService.mget(cacheKeys);
      const cacheMisses: string[] = [];

      for (let i = 0; i < vendorIds.length; i++) {
        const vendorId = vendorIds[i];
        const cachedValue = cachedValues[i];

        if (cachedValue) {
          try {
            const parsedValue = JSON.parse(cachedValue) as VendorAPICache;
            result.set(vendorId, parsedValue);
            this.logger.debug(`Cache hit for vendor API: ${vendorId}`);
          } catch (parseError) {
            this.logger.warn(`Failed to parse cached data for vendor ${vendorId}:`, parseError);
            cacheMisses.push(vendorId);
          }
        } else {
          cacheMisses.push(vendorId);
        }
      }

      if (cacheMisses.length > 0) {
        this.logger.debug(`Cache misses for vendors: ${cacheMisses.join(', ')}`);

        const dbResults = await this.prismaService.vendorAPI.findMany({
          where: {
            vendorId: { in: cacheMisses },
            isActive: true,
          },
        });

        const groupedResults = new Map<string, VendorAPICache>();
        dbResults.forEach(api => {
          if (!groupedResults.has(api.vendorId) || api.updatedAt > groupedResults.get(api.vendorId)!.updatedAt) {
            groupedResults.set(api.vendorId, api);
          }
        });

        for (const vendorId of cacheMisses) {
          const vendorAPI = groupedResults.get(vendorId) || null;
          result.set(vendorId, vendorAPI);

          if (vendorAPI) {
            this.cacheVendorAPI(vendorId, vendorAPI).catch(error => {
              this.logger.warn(`Failed to cache vendor API for ${vendorId}:`, error);
            });
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error('Error in batch vendor API retrieval:', error);

      try {
        const dbResults = await this.prismaService.vendorAPI.findMany({
          where: {
            vendorId: { in: vendorIds },
            isActive: true,
          },
        });

        const groupedResults = new Map<string, VendorAPICache>();
        dbResults.forEach(api => {
          if (!groupedResults.has(api.vendorId) || api.updatedAt > groupedResults.get(api.vendorId)!.updatedAt) {
            groupedResults.set(api.vendorId, api);
          }
        });

        vendorIds.forEach(vendorId => {
          result.set(vendorId, groupedResults.get(vendorId) || null);
        });

        return result;
      } catch (dbError) {
        this.logger.error('Database fallback failed for batch vendor API retrieval:', dbError);
        throw dbError;
      }
    }
  }

  async isVendorAPICached(vendorId: string): Promise<boolean> {
    const cacheKey = this.getCacheKey(vendorId);
    return await this.valkeyService.exists(cacheKey);
  }

  async getCacheStats(): Promise<{ totalKeys: number; vendorAPIKeys: string[] }> {
    try {
      const pattern = `${this.CACHE_PREFIX}:*`;
      const keys = await this.valkeyService.customCommand(['KEYS', pattern]);

      return {
        totalKeys: Array.isArray(keys) ? keys.length : 0,
        vendorAPIKeys: Array.isArray(keys) ? keys : [],
      };
    } catch (error) {
      this.logger.error('Failed to get cache stats:', error);
      return { totalKeys: 0, vendorAPIKeys: [] };
    }
  }
}
