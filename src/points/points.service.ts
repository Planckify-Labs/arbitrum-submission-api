import {
  PointTransactionStatus,
  PointTransactionType,
  Prisma,
  ReferenceIdStatus,
} from "@generated/prisma";
import { InjectQueue } from "@nestjs/bullmq";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Queue } from "bullmq";
import { addressesEqual } from "../auth/address-compare";
import { SETTLEMENT_JOB_OPTIONS } from "../blockchain-verification/settlement-policy";
import { ExchangeRateService } from "../exchange-rate/exchange-rate.service";
import { PrismaService } from "../prisma/prisma.service";
import { ReferenceIdService } from "../reference-id/reference-id.service";
import { PointsCacheService } from "../valkey/services/points-cache.service";
import { CreatePointDepositDto } from "./dto/create-point-deposit.dto";
import { GetPointPriceQueryDto } from "./dto/get-point-price-query.dto";
import { PointHistoryQueryDto } from "./dto/point-history-query.dto";
import { PointPriceResponseDto } from "./dto/point-price-response.dto";

const MINIMUM_POINTS = 15_000;

@Injectable()
export class PointsService {
  private readonly logger = new Logger(PointsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRateService: ExchangeRateService,
    private readonly pointsCache: PointsCacheService,
    private readonly referenceIdService: ReferenceIdService,
    @InjectQueue("point-deposit") private readonly pointDepositQueue: Queue,
  ) {}

  // ── GET /points/price ──────────────────────────────────────────────────────

  async getPointPrice(
    query: GetPointPriceQueryDto,
  ): Promise<PointPriceResponseDto> {
    return this.pointsCache.getPointPrice(
      query.tokenId,
      query.currency,
      async () => {
        const token = await this.prisma.token.findUnique({
          where: { id: query.tokenId },
        });

        if (!token) {
          throw new BadRequestException(
            `Token with ID ${query.tokenId} not found`,
          );
        }
        if (!token.isActive) {
          throw new BadRequestException(`Token ${token.symbol} is not active`);
        }
        if (!token.isStablecoin) {
          throw new BadRequestException(
            `Token ${token.symbol} is not a stablecoin`,
          );
        }
        // `isPaymentEnabled` is the ops switch for "cleared for user-facing
        // payment flows". Mobile already filters its deposit token list on it,
        // so quoting a token without it means the caller went around that list.
        if (!token.isPaymentEnabled) {
          throw new BadRequestException(
            `Token ${token.symbol} is not enabled for payments`,
          );
        }

        const priceConfig = await this.pointsCache.getPointConfig(
          query.currency,
          () =>
            this.prisma.pointPriceConfig.findFirst({
              where: { currency: query.currency, isActive: true },
              orderBy: { createdAt: "desc" },
            }),
        );

        if (!priceConfig) {
          throw new BadRequestException(
            `No active point price config for currency ${query.currency}`,
          );
        }

        // If the token is already pegged to the requested currency, it's 1:1 — no exchange rate needed.
        // Otherwise look up the live rate (e.g. USDT → IDR).
        let tokenPriceInCurrency: Prisma.Decimal;
        if (token.peggedCurrency === query.currency) {
          tokenPriceInCurrency = new Prisma.Decimal(1);
        } else {
          const exchangeRate = await this.exchangeRateService.findLatest({
            fromCurrency: token.symbol,
            toCurrency: query.currency,
          });

          if (!exchangeRate) {
            throw new BadRequestException(
              `No exchange rate found for ${token.symbol} → ${query.currency}`,
            );
          }

          tokenPriceInCurrency = new Prisma.Decimal(
            exchangeRate.rate.toString(),
          );
        }
        const baseRate = new Prisma.Decimal(priceConfig.baseRate.toString());

        const pointsPerToken = tokenPriceInCurrency.div(baseRate).floor();
        const tokenPerPoint = baseRate.div(tokenPriceInCurrency);
        const minimumTokenAmount = new Prisma.Decimal(MINIMUM_POINTS).mul(
          tokenPerPoint,
        );

        return {
          pointPrice: baseRate.toFixed(0),
          currency: query.currency,
          token: {
            id: token.id,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimals,
            priceInCurrency: tokenPriceInCurrency.toString(),
          },
          pointsPerToken: pointsPerToken.toString(),
          // Full precision — this is the rate mobile multiplies by the
          // requested point count to derive the token amount to deposit.
          // Truncating it (previously 6 sig figs) understates the token
          // amount needed, and since the crediting worker recomputes points
          // from the actually-deposited amount, that shortfall silently
          // costs the user points (worse at larger deposits).
          tokenPerPoint: tokenPerPoint.toSignificantDigits(18).toString(),
          minimumPoints: MINIMUM_POINTS,
          minimumTokenAmount: minimumTokenAmount
            .toSignificantDigits(18)
            .toString(),
          updatedAt: new Date().toISOString(),
        };
      },
    );
  }

  // ── GET /points/balance ────────────────────────────────────────────────────

  getBalance(userId: string): Promise<{ userId: string; balance: string }> {
    return this.pointsCache.getPointBalance(userId, async () => {
      const balance = await this.prisma.pointBalance.findUnique({
        where: { userId },
      });
      return { userId, balance: balance ? balance.balance.toString() : "0" };
    });
  }

  // ── POST /points/deposit ───────────────────────────────────────────────────

  async createDeposit(userId: string, dto: CreatePointDepositDto) {
    // 1. Validate wallet belongs to authenticated user
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // Ownership: the deposit's on-chain payer must be an address this user
    // controls. For EVM that's their primary `walletAddress` (proven at
    // sign-in). For non-EVM chains (e.g. Stellar) the on-chain payer is a
    // per-chain address (the G-address) that differs from the primary — accept
    // it when the user has linked it to their account (WalletAccountLink, via
    // POST /auth/google/wallets). The linked address is then bound to this
    // deposit and re-verified against the on-chain payer by the worker.
    let ownsDepositAddress = addressesEqual(
      user.walletAddress,
      dto.walletAddress,
    );
    if (!ownsDepositAddress) {
      const links = await this.prisma.walletAccountLink.findMany({
        where: { userId },
        select: { walletAddress: true },
      });
      ownsDepositAddress = links.some((l) =>
        addressesEqual(l.walletAddress, dto.walletAddress),
      );
    }
    if (!ownsDepositAddress) {
      throw new BadRequestException(
        "Wallet address does not belong to the authenticated user",
      );
    }

    // 2. Atomically claim the refId via the ReferenceId table.
    //    The ReferenceId table has a DB-level @unique on refId, so a plain
    //    CREATE is race-safe — only one concurrent request wins; the other
    //    gets P2002 and we return the in-progress deposit instead.
    try {
      await this.prisma.referenceId.create({
        data: { refId: dto.refId, status: ReferenceIdStatus.PROCESSING },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        // refId already claimed — look up the existing PointTransaction
        const existing = await this.prisma.pointTransaction.findFirst({
          where: { refId: dto.refId },
          orderBy: { createdAt: "desc" },
        });

        if (existing?.status !== PointTransactionStatus.FAILED) {
          return {
            id: existing?.id ?? "",
            status: existing?.status ?? PointTransactionStatus.PENDING,
            refId: dto.refId,
            message: "Deposit already submitted.",
          };
        }

        // Previous attempt FAILED — reset ReferenceId and allow retry
        await this.prisma.referenceId.update({
          where: { refId: dto.refId },
          data: { status: ReferenceIdStatus.PROCESSING },
        });
      } else {
        throw error;
      }
    }

    // Check txHash uniqueness
    if (dto.txHash) {
      const existingByHash = await this.prisma.pointTransaction.findFirst({
        where: { txHash: dto.txHash },
      });
      if (
        existingByHash &&
        existingByHash.status !== PointTransactionStatus.FAILED
      ) {
        throw new ConflictException("Transaction hash already submitted");
      }
    }

    // 3. Validate token
    const token = await this.prisma.token.findUnique({
      where: { id: dto.tokenId },
    });
    if (!token || !token.isActive || !token.isStablecoin) {
      throw new BadRequestException("Invalid or inactive stablecoin token");
    }
    // Ops gate, enforced server-side so it can't be bypassed by a client that
    // skips the token list (mobile filters on the same flag). Intake only —
    // `point-deposit.processor.ts` deliberately does NOT re-check it, so a
    // deposit already sent on-chain still credits if ops flips the flag while
    // it is in flight.
    if (!token.isPaymentEnabled) {
      throw new BadRequestException(
        `Token ${token.symbol} is not enabled for payments`,
      );
    }

    // 4. Validate blockchain
    const blockchain = await this.prisma.blockchain.findUnique({
      where: { id: dto.blockchainId },
    });
    if (!blockchain || !blockchain.isActive) {
      throw new BadRequestException("Invalid or inactive blockchain");
    }

    // 5. Validate smart contract
    const contract = await this.prisma.smartContract.findFirst({
      where: {
        blockchainId: dto.blockchainId,
        address: { equals: dto.contractAddress, mode: "insensitive" },
        isActive: true,
      },
    });
    if (!contract) {
      throw new BadRequestException(
        `Smart contract ${dto.contractAddress} not found or not active`,
      );
    }

    // 6. Server-side point calculation
    // Use the same formula as getPointPrice: fetch exchange rate (token → currency),
    // then pointRate = exchangeRate / baseRate. This ensures the deposited token amount
    // and credited points are always consistent regardless of which stablecoin is used.
    const currency = dto.currency ?? "IDR";

    const priceConfig = await this.prisma.pointPriceConfig.findFirst({
      where: { currency, isActive: true },
      orderBy: { createdAt: "desc" },
    });

    if (!priceConfig) {
      throw new BadRequestException(
        `No active point price config for currency ${currency}`,
      );
    }

    // If the token is already pegged to the target currency, it's 1:1 — no exchange rate needed.
    // Otherwise look up the live rate (e.g. USDT → IDR).
    let tokenRateInCurrency: Prisma.Decimal;
    if (token.peggedCurrency === currency) {
      tokenRateInCurrency = new Prisma.Decimal(1);
    } else {
      const exchangeRate = await this.exchangeRateService.findLatest({
        fromCurrency: token.symbol,
        toCurrency: currency,
      });

      if (!exchangeRate) {
        throw new BadRequestException(
          `No exchange rate found for ${token.symbol} → ${currency}`,
        );
      }

      tokenRateInCurrency = new Prisma.Decimal(exchangeRate.rate.toString());
    }

    // pointRate = how many points per 1 token unit
    // e.g. IDRX→IDR = 1:1, IDR baseRate = 1 → 1/1 = 1 pt/IDRX
    // e.g. USDT→IDR = 16,000, IDR baseRate = 1 → 16000/1 = 16000 pts/USDT
    const pointRate = tokenRateInCurrency.div(priceConfig.baseRate);

    // 7. Create PointTransaction record
    const pointTx = await this.prisma.pointTransaction.create({
      data: {
        userId,
        type: PointTransactionType.DEPOSIT,
        status: PointTransactionStatus.PENDING,
        amount: BigInt(0),
        balanceBefore: BigInt(0),
        balanceAfter: BigInt(0),
        refId: dto.refId,
        txHash: dto.txHash,
        tokenId: dto.tokenId,
        blockchainId: dto.blockchainId,
        contractAddress: dto.contractAddress,
        walletAddress: dto.walletAddress,
        tokenAmount: new Prisma.Decimal(dto.tokenAmount),
        pointRate,
      },
    });

    // 8. Enqueue verification job
    await this.pointDepositQueue.add(
      "verify-deposit",
      {
        pointTransactionId: pointTx.id,
        pointTransactionCreatedAt: pointTx.createdAt,
      },
      // Long, capped schedule: a deposit is only ever told "didn't go
      // through" on a chain verdict, so our own outages just delay it.
      SETTLEMENT_JOB_OPTIONS,
    );

    this.logger.log(
      `Point deposit submitted: ${pointTx.id} for user ${userId}`,
    );

    return {
      id: pointTx.id,
      status: PointTransactionStatus.PENDING,
      refId: dto.refId,
      message:
        "Deposit submitted. Points will be credited after on-chain verification.",
    };
  }

  // ── GET /points/history ────────────────────────────────────────────────────

  async getHistory(userId: string, query: PointHistoryQueryDto) {
    const limit = query.limit ?? 20;
    const where: Prisma.PointTransactionWhereInput = { userId };

    if (query.type) where.type = query.type;
    if (query.status) where.status = query.status;
    if (query.cursor) {
      where.id = { lt: query.cursor };
    }

    const records = await this.prisma.pointTransaction.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit + 1,
      include: { token: { select: { symbol: true } } },
    });

    const hasMore = records.length > limit;
    const data = hasMore ? records.slice(0, limit) : records;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data: data.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        balanceBefore: tx.balanceBefore.toString(),
        balanceAfter: tx.balanceAfter.toString(),
        status: tx.status,
        tokenAmount: tx.tokenAmount?.toString() ?? null,
        tokenSymbol: tx.token?.symbol ?? null,
        txHash: tx.txHash,
        refId: tx.refId,
        referenceType: tx.referenceType,
        referenceId: tx.referenceId,
        createdAt: tx.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }

  // ── GET /points/deposit/:id/status ────────────────────────────────────────

  async getDepositStatus(userId: string, id: string) {
    const tx = await this.prisma.pointTransaction.findFirst({
      where: { id, userId, type: PointTransactionType.DEPOSIT },
    });

    if (!tx) throw new NotFoundException("Deposit not found");

    return {
      id: tx.id,
      status: tx.status,
      amount: tx.amount.toString(),
      refId: tx.refId,
      createdAt: tx.createdAt.toISOString(),
    };
  }

  // ── GET /points/summary ────────────────────────────────────────────────────

  async getPointsSummary(userId: string) {
    const [balance, totalEarned, totalSpent, recentTransactions] =
      await Promise.all([
        this.prisma.pointBalance.findUnique({
          where: { userId },
          select: { balance: true },
        }),
        this.prisma.pointTransaction.aggregate({
          where: {
            userId,
            type: PointTransactionType.DEPOSIT,
            status: PointTransactionStatus.COMPLETED,
          },
          _sum: { amount: true },
        }),
        this.prisma.pointTransaction.aggregate({
          where: {
            userId,
            type: PointTransactionType.SPEND,
          },
          _sum: { amount: true },
        }),
        this.prisma.pointTransaction.findMany({
          where: { userId },
          select: {
            id: true,
            type: true,
            amount: true,
            status: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 5,
        }),
      ]);

    return {
      balance: balance?.balance?.toString() ?? "0",
      totalEarned: totalEarned._sum.amount?.toString() ?? "0",
      totalSpent: totalSpent._sum.amount?.toString() ?? "0",
      recentTransactions,
    };
  }

  // ── Internal: deductPoints ─────────────────────────────────────────────────

  async deductPoints(dto: {
    userId: string;
    amount: bigint;
    referenceType: string;
    referenceId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const balance = await tx.pointBalance.findUnique({
        where: { userId: dto.userId },
      });

      const currentBalance = balance?.balance ?? BigInt(0);

      if (currentBalance < dto.amount) {
        throw new BadRequestException(
          `Insufficient point balance: have ${currentBalance}, need ${dto.amount}`,
        );
      }

      const newBalance = currentBalance - dto.amount;

      await tx.pointTransaction.create({
        data: {
          userId: dto.userId,
          type: PointTransactionType.SPEND,
          status: PointTransactionStatus.COMPLETED,
          amount: -dto.amount,
          balanceBefore: currentBalance,
          balanceAfter: newBalance,
          referenceType: dto.referenceType,
          referenceId: dto.referenceId,
        },
      });

      await tx.pointBalance.update({
        where: { userId: dto.userId },
        data: { balance: newBalance },
      });
    });

    await this.pointsCache.invalidateBalance(dto.userId);
  }

  // ── Admin: get balance for a specific user ─────────────────────────────────

  getBalanceAdmin(userId: string) {
    return this.getBalance(userId);
  }

  // ── Admin: get all users' point history ───────────────────────────────────

  async getHistoryAdmin(query: PointHistoryQueryDto & { userId?: string }) {
    const { userId, ...rest } = query;
    if (userId) {
      return this.getHistory(userId, rest);
    }
    // Return all users' history
    const limit = rest.limit ?? 20;
    const where: Prisma.PointTransactionWhereInput = {};
    if (rest.type) where.type = rest.type;
    if (rest.status) where.status = rest.status;
    if (rest.cursor) {
      where.id = { lt: rest.cursor };
    }

    const records = await this.prisma.pointTransaction.findMany({
      where,
      take: limit + 1,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        user: {
          select: {
            id: true,
            username: true,
            email: true,
            walletAddress: true,
          },
        },
        token: { select: { symbol: true } },
      },
    });

    const hasMore = records.length > limit;
    const data = hasMore ? records.slice(0, limit) : records;
    const nextCursor = hasMore ? data[data.length - 1].id : null;

    return {
      data: data.map((tx) => ({
        id: tx.id,
        type: tx.type,
        amount: tx.amount.toString(),
        balanceBefore: tx.balanceBefore.toString(),
        balanceAfter: tx.balanceAfter.toString(),
        status: tx.status,
        tokenAmount: tx.tokenAmount?.toString() ?? null,
        tokenSymbol: tx.token?.symbol ?? null,
        txHash: tx.txHash,
        refId: tx.refId,
        referenceType: tx.referenceType,
        referenceId: tx.referenceId,
        user: tx.user,
        createdAt: tx.createdAt.toISOString(),
      })),
      nextCursor,
      hasMore,
    };
  }

  // ── Admin: get points summary for a specific user ─────────────────────────

  getSummaryAdmin(userId: string) {
    return this.getPointsSummary(userId);
  }

  // ── Admin: get all user balances ──────────────────────────────────────────

  async getAllBalancesAdmin() {
    const users = await this.prisma.user.findMany({
      select: {
        id: true,
        username: true,
        email: true,
        walletAddress: true,
      },
    });
    const balances = await Promise.all(
      users.map(async (user) => {
        try {
          const balance = await this.getBalance(user.id);
          return { ...user, balance };
        } catch {
          return { ...user, balance: 0 };
        }
      }),
    );
    return balances.filter((b) => b.balance !== 0);
  }

  // ── Admin: update PointPriceConfig ─────────────────────────────────────────

  async updatePriceConfig(
    currency: string,
    baseRate: string,
    createdBy?: string,
  ) {
    await this.prisma.$transaction(async (tx) => {
      // Deactivate existing active config for currency
      await tx.pointPriceConfig.updateMany({
        where: { currency, isActive: true },
        data: { isActive: false },
      });

      await tx.pointPriceConfig.create({
        data: {
          currency,
          baseRate: new Prisma.Decimal(baseRate),
          isActive: true,
          createdBy,
        },
      });
    });

    await this.pointsCache.invalidateConfig(currency);
    await this.pointsCache.invalidatePrices();

    this.logger.log(
      `Updated point price config for ${currency}: baseRate=${baseRate}`,
    );

    return { currency, baseRate, message: "Price config updated successfully" };
  }
}
