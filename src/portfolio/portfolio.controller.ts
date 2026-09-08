import { Controller, Get, Query, Request, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { JwtAuthGuard } from "../auth/guards/jwt-auth.guard";
import {
  ZerionClient,
  type ZerionChainSelector,
} from "../external/zerion";

interface AuthedRequest {
  user?: {
    id: string;
    walletAddress?: string;
  };
}

/**
 * Parse the `chain_ids` CSV. Entries are numeric EVM chain ids, or a bare
 * namespace for chains that have no numeric id ("solana"). Unknown entries are
 * dropped downstream by the capability table rather than rejected here, so a
 * client that knows about a chain we haven't enabled yet degrades to "no rows
 * for that chain" instead of a hard error.
 */
function parseChains(csv?: string): ZerionChainSelector[] | undefined {
  if (!csv) return undefined;
  const parts = csv
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return parts.map((p) => (/^\d+$/.test(p) ? Number(p) : p));
}

/** Only an explicit truthy value forces a refresh; anything else is cached. */
function parseRefresh(value?: string): boolean {
  return value === "true" || value === "1";
}

/**
 * Read-only portfolio surface backed by Zerion.
 *
 * Two invariants hold across every route here:
 *
 *  1. **The wallet comes from the JWT**, never from a query param. Accepting a
 *     caller-supplied address would turn our key and our shared daily quota
 *     into a public wallet-lookup service.
 *  2. **Cached by default, fresh only on request.** Mounting a screen costs
 *     nothing upstream; `?refresh=true` (a deliberate pull-to-refresh) is the
 *     only thing that spends quota. See `ZerionClient.cached`.
 *
 * Responses are always HTTP 200 with a `status` field. A literal 202 would
 * flow oddly through the mobile ky client, where status-code signalling is
 * already fragile.
 */
@ApiTags("portfolio")
@Controller("portfolio")
@UseGuards(JwtAuthGuard)
export class PortfolioController {
  constructor(private readonly zerion: ZerionClient) {}

  private getWalletAddress(req: AuthedRequest): string {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      // Deliberately terse: this string reaches logs, never a user.
      throw new Error("wallet address missing from JWT");
    }
    return walletAddress;
  }

  @Get("discovered-assets")
  @ApiOperation({
    summary:
      "Assets this wallet is known to hold (identity only, no balances)",
  })
  @ApiQuery({ name: "chain_ids", required: false })
  @ApiQuery({ name: "refresh", required: false })
  discoveredAssets(
    @Request() req: AuthedRequest,
    @Query("chain_ids") chainIds?: string,
    @Query("refresh") refresh?: string,
  ) {
    return this.zerion.discoverAssets(this.getWalletAddress(req), {
      chains: parseChains(chainIds),
      refresh: parseRefresh(refresh),
    });
  }

  @Get("defi-positions")
  @ApiOperation({ summary: "DeFi positions grouped per protocol" })
  @ApiQuery({ name: "chain_ids", required: false })
  @ApiQuery({ name: "refresh", required: false })
  defiPositions(
    @Request() req: AuthedRequest,
    @Query("chain_ids") chainIds?: string,
    @Query("refresh") refresh?: string,
  ) {
    return this.zerion.getDefiPositions(this.getWalletAddress(req), {
      chains: parseChains(chainIds),
      refresh: parseRefresh(refresh),
    });
  }

  @Get("nfts")
  @ApiOperation({ summary: "NFT positions with media and floor price" })
  @ApiQuery({ name: "chain_ids", required: false })
  @ApiQuery({ name: "refresh", required: false })
  @ApiQuery({ name: "page_size", required: false })
  @ApiQuery({ name: "page_after", required: false })
  async nfts(
    @Request() req: AuthedRequest,
    @Query("chain_ids") chainIds?: string,
    @Query("refresh") refresh?: string,
    @Query("page_size") pageSize?: string,
    @Query("page_after") pageAfter?: string,
  ) {
    const parsedSize = pageSize ? Number(pageSize) : undefined;
    const result = await this.zerion.getNftPositions(
      this.getWalletAddress(req),
      {
        chains: parseChains(chainIds),
        refresh: parseRefresh(refresh),
        pageSize:
          typeof parsedSize === "number" && Number.isFinite(parsedSize)
            ? parsedSize
            : undefined,
        pageAfter,
      },
    );
    // Flatten the cached {items, nextCursor} page into the same envelope the
    // other two routes return, so every portfolio response reads alike.
    return { ...result, data: result.data.items };
  }
}
