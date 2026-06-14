import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { CreateBlockchainDto } from "./dto/create-blockchain.dto";
import { UpdateBlockchainDto } from "./dto/update-blockchain.dto";
import { SearchBlockchainDto } from "./dto/search-blockchain.dto";
import { Prisma } from "@generated/prisma";
import { CursorPaginationDto } from "../dto/common/pagination.dto";
import { BlockchainCacheService } from "../valkey/services/blockchain-cache.service";
import { X402SupportedService } from "../x402/x402-supported.service";
import {
  enrichBlockchain,
  type TBlockchainRow,
} from "./blockchain-enricher";
import type { EnrichedBlockchainResponseDto } from "./dto/enriched-blockchain-response.dto";
import { createHash } from "node:crypto";

/**
 * Country → allow-list of EVM chainIds a payer in that jurisdiction can use.
 * Spec §6.7 + task 21: M2 ships Indonesia on Arc Testnet only. Expanding this
 * means adding an entry here OR overriding via
 * `BLOCKCHAINS_COUNTRY_ALLOWLIST_<ISO>` env (comma-separated chainIds). DB
 * migration would be cleaner long-term but config/env gating keeps the
 * no-hardcoded-chainId-in-controller rule while still being ops-editable.
 */
const DEFAULT_COUNTRY_ALLOWLIST: Readonly<Record<string, readonly number[]>> = {
  // Arc Testnet only during M2. Mainnet cuts over in §48.
  ID: [5042002],
};

interface EnrichedResponsePayload {
  blockchains: EnrichedBlockchainResponseDto[];
  etag: string;
}

@Injectable()
export class BlockchainsService {
  private readonly logger = new Logger(BlockchainsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blockchainCache: BlockchainCacheService,
    private readonly configService: ConfigService,
    private readonly x402Supported: X402SupportedService,
  ) {}

  async create(createBlockchainDto: CreateBlockchainDto) {
    return await this.prisma.blockchain.create({
      data: createBlockchainDto,
    });
  }

  async findAll(paginationDto: CursorPaginationDto) {
    const { cursor, take = 10 } = paginationDto;

    return this.blockchainCache.getAllBlockchains(cursor, () =>
      this.prisma.blockchain.findMany({
        take,
        skip: cursor ? 1 : 0,
        cursor: cursor ? { id: cursor } : undefined,
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
    );
  }

  /**
   * Enriched chain-config for mobile (§6.7, task 21). Returns **all active**
   * chains (not paginated — there are ~13 Gateway-supported chains total;
   * pagination on a config endpoint is net-harmful because mobile needs the
   * full set to render a chain picker).
   *
   * - Joins `tokens` (native + USDC stablecoins in one query).
   * - Serializes via {@link enrichBlockchain} for nested-nullable objects.
   * - Falls back to {@link X402SupportedService} for x402 fields when DB columns
   *   are null (task 22 is in flight; this endpoint must still be useful
   *   before task 22 writes those columns).
   * - Optional `country` filter gates chains by jurisdiction allow-list.
   * - Cached in Valkey with 5-minute TTL; ETag is SHA-256 over
   *   max(updatedAt) + x402-refresh-timestamp so a chain-row edit or a fresh
   *   Circle x402 refresh both bust 304s cleanly.
   */
  getEnrichedConfig(
    country?: string,
  ): Promise<EnrichedResponsePayload> {
    const countrySegment = country ? country.toUpperCase() : "all";

    // Cache-aside at 5 min. Invalidation happens on update/delete via
    // `blockchainCache.invalidateBlockchain` (pattern `blockchains:*`), which
    // already wipes this key.
    return this.blockchainCache.getEnrichedConfig<EnrichedResponsePayload>(
      countrySegment,
      async () => this.buildEnrichedConfig(country),
    );
  }

  /**
   * Uncached enrichment path. Used by {@link getEnrichedConfig} on cache
   * miss; exposed as a named method so tests can bypass Valkey.
   */
  async buildEnrichedConfig(
    country?: string,
  ): Promise<EnrichedResponsePayload> {
    const where: Prisma.BlockchainWhereInput = { isActive: true };

    if (country) {
      const allow = this.resolveCountryAllowlist(country);
      if (allow === null) {
        // Unknown country — return empty set rather than 404 so mobile can
        // render an "unsupported region" state without a hard error.
        this.logger.debug(
          `No country allow-list entry for "${country}"; returning empty chain set.`,
        );
        where.chainId = { in: [] };
      } else {
        where.chainId = { in: allow };
      }
    }

    const rows = await this.prisma.blockchain.findMany({
      where,
      include: {
        tokens: {
          where: {
            // Native currency (ETH, USDC-on-Arc, SOL) OR USDC stablecoin.
            // One query, two use-cases — mobile uses both.
            OR: [
              { isNativeCurrency: true },
              { AND: [{ isStablecoin: true }, { symbol: "USDC" }] },
            ],
            isActive: true,
          },
        },
        SmartContract: {
          where: { isActive: true },
        },
      },
      orderBy: { name: "asc" },
    });

    const enriched = rows.map((row) =>
      enrichBlockchain(row as unknown as TBlockchainRow, this.x402Supported),
    );

    const etag = this.computeEtag(rows);
    return { blockchains: enriched, etag };
  }

  /**
   * Env override → static default. Returns `null` for unknown countries so
   * callers can emit an empty set cleanly.
   */
  private resolveCountryAllowlist(country: string): number[] | null {
    const iso = country.toUpperCase();
    const envKey = `BLOCKCHAINS_COUNTRY_ALLOWLIST_${iso}`;
    const envValue = this.configService.get<string>(envKey);
    if (envValue) {
      const parsed = envValue
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (parsed.length > 0) return parsed;
    }

    const fallback = DEFAULT_COUNTRY_ALLOWLIST[iso];
    return fallback ? [...fallback] : null;
  }

  private computeEtag(
    rows: Array<{ updatedAt: Date }>,
  ): string {
    const maxUpdated = rows.reduce<number>((acc, row) => {
      const t = row.updatedAt?.getTime?.() ?? 0;
      return t > acc ? t : acc;
    }, 0);
    const x402Rev = this.x402Supported?.getLastRefreshAt() ?? 0;
    const hash = createHash("sha256");
    hash.update(`${maxUpdated}:${x402Rev}:${rows.length}`);
    // Weak ETag — response body isn't byte-identical across gzip encodings but
    // the content is semantically the same for a given (maxUpdated, x402Rev).
    return `W/"${hash.digest("hex").slice(0, 32)}"`;
  }

  async search(
    searchParams: SearchBlockchainDto,
    paginationDto: CursorPaginationDto,
  ) {
    const { cursor, take = 10, skip } = paginationDto;
    const useSkip = typeof skip === "number" && skip > 0;
    const { name, chainId, isEVM, isActive, isTestnet } = searchParams;

    const where: Prisma.BlockchainWhereInput = {};

    if (name) {
      where.name = {
        contains: name,
        mode: "insensitive",
      };
    }

    if (chainId) {
      where.chainId = chainId;
    }

    if (isEVM !== undefined) {
      where.isEVM = isEVM;
    }

    if (isActive !== undefined) {
      where.isActive = isActive;
    }

    if (isTestnet !== undefined) {
      where.isTestnet = isTestnet;
    }

    const findArgs = {
      take,
      skip: useSkip ? skip : cursor ? 1 : 0,
      cursor: useSkip ? undefined : cursor ? { id: cursor } : undefined,
    };

    const [items, total] = await Promise.all([
      this.prisma.blockchain.findMany({
        ...findArgs,
        where,
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
            },
          },
        },
        orderBy: {
          name: "asc",
        },
      }),
      this.prisma.blockchain.count({ where }),
    ]);

    return { items, total };
  }

  async findOne(id: string) {
    const blockchain = await this.blockchainCache.getById(id, () =>
      this.prisma.blockchain.findUnique({
        where: { id },
        include: {
          tokens: {
            where: {
              isNativeCurrency: true,
            },
          },
        },
      }),
    );

    if (!blockchain) {
      throw new NotFoundException(`Blockchain with ID "${id}" not found`);
    }

    return blockchain;
  }

  async update(id: string, updateBlockchainDto: UpdateBlockchainDto) {
    try {
      const result = await this.prisma.blockchain.update({
        where: { id },
        data: updateBlockchainDto,
      });
      // Invalidate cache after update
      await this.blockchainCache.invalidateBlockchain(id);
      return result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Blockchain with ID "${id}" not found`);
      }
      throw error;
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.blockchain.delete({
        where: { id },
      });
      // Invalidate cache after delete
      await this.blockchainCache.invalidateBlockchain(id);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2025"
      ) {
        throw new NotFoundException(`Blockchain with ID "${id}" not found`);
      }
      throw error;
    }
  }
}
