import {
  Injectable,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Logger,
} from "@nestjs/common";
import { InjectQueue } from "@nestjs/bullmq";
import { Queue } from "bullmq";
import { PrismaService } from "../prisma/prisma.service";
import { ExchangeRateService } from "../exchange-rate/exchange-rate.service";
import { PointsCacheService } from "../valkey/services/points-cache.service";
import { Prisma, PointTransactionStatus, PointTransactionType } from "@generated/prisma";
import { GetPointPriceQueryDto } from "./dto/get-point-price-query.dto";
import { CreatePointDepositDto } from "./dto/create-point-deposit.dto";
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
    @InjectQueue("point-deposit") private readonly pointDepositQueue: Queue,
  ) {}

  // ── GET /points/price ──────────────────────────────────────────────────────

  async getPointPrice(query: GetPointPriceQueryDto): Promise<PointPriceResponseDto> {
    return this.pointsCache.getPointPrice(query.tokenId, query.currency, async () => {
      const token = await this.prisma.token.findUnique({
        where: { id: query.tokenId },
      });

      if (!token) {
        throw new BadRequestException(`Token with ID ${query.tokenId} not found`);
      }
      if (!token.isActive) {
        throw new BadRequestException(`Token ${token.symbol} is not active`);
      }
      if (!token.isStablecoin) {
        throw new BadRequestException(`Token ${token.symbol} is not a stablecoin`);
      }

      const exchangeRate = await this.exchangeRateService.findLatest({
        fromCurrency: token.symbol,
        toCurrency: query.currency,
      });

      if (!exchangeRate) {
        throw new BadRequestException(
          `No exchange rate found for ${token.symbol} → ${query.currency}`,
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

      const tokenPriceInCurrency = new Prisma.Decimal(exchangeRate.rate.toString());
      const baseRate = new Prisma.Decimal(priceConfig.baseRate.toString());

      const pointsPerToken = tokenPriceInCurrency.div(baseRate).floor();
      const tokenPerPoint = baseRate.div(tokenPriceInCurrency);
      const minimumTokenAmount = new Prisma.Decimal(MINIMUM_POINTS).mul(tokenPerPoint);

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
        tokenPerPoint: tokenPerPoint.toSignificantDigits(6).toString(),
        minimumPoints: MINIMUM_POINTS,
        minimumTokenAmount: minimumTokenAmount.toSignificantDigits(8).toString(),
        updatedAt: new Date().toISOString(),
      };
    });
  }

  // ── GET /points/balance ────────────────────────────────────────────────────

  async getBalance(userId: string): Promise<{ userId: string; balance: string }> {
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

    if (
      !user.walletAddress ||
      user.walletAddress.toLowerCase() !== dto.walletAddress.toLowerCase()
    ) {
      throw new BadRequestException(
        "Wallet address does not belong to the authenticated user",
      );
    }

    // 2. Check refId idempotency
    const existing = await this.prisma.pointTransaction.findUnique({
      where: { refId: dto.refId },
    });

    if (existing) {
      if (
        existing.status === PointTransactionStatus.COMPLETED ||
        existing.status === PointTransactionStatus.PENDING ||
        existing.status === PointTransactionStatus.CONFIRMED
      ) {
        return {
          id: existing.id,
          status: existing.status,
          refId: existing.refId,
          message: "Deposit already submitted.",
        };
      }
      // FAILED → allow retry (fall through to create new record)
    }

    // Check txHash uniqueness
    if (dto.txHash) {
      const existingByHash = await this.prisma.pointTransaction.findUnique({
        where: { txHash: dto.txHash },
      });
      if (existingByHash && existingByHash.status !== PointTransactionStatus.FAILED) {
        throw new ConflictException(
          "Transaction hash already submitted",
        );
      }
    }

    // 3. Validate token
    const token = await this.prisma.token.findUnique({ where: { id: dto.tokenId } });
    if (!token || !token.isActive || !token.isStablecoin) {
      throw new BadRequestException("Invalid or inactive stablecoin token");
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
    const priceConfig = await this.prisma.pointPriceConfig.findFirst({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });

    let pointRate: Prisma.Decimal | null = null;
    if (priceConfig) {
      const exchangeRate = await this.exchangeRateService.findLatest({
        fromCurrency: token.symbol,
        toCurrency: priceConfig.currency,
      });
      if (exchangeRate) {
        const tokenPrice = new Prisma.Decimal(exchangeRate.rate.toString());
        pointRate = tokenPrice.div(priceConfig.baseRate).floor();
      }
    }

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
        tokenAmount: new Prisma.Decimal(dto.tokenAmount),
        pointRate,
      },
    });

    // 8. Enqueue verification job
    await this.pointDepositQueue.add(
      "verify-deposit",
      { pointTransactionId: pointTx.id },
      {
        attempts: 5,
        backoff: { type: "exponential", delay: 3000 },
      },
    );

    this.logger.log(`Point deposit submitted: ${pointTx.id} for user ${userId}`);

    return {
      id: pointTx.id,
      status: PointTransactionStatus.PENDING,
      refId: dto.refId,
      message: "Deposit submitted. Points will be credited after on-chain verification.",
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

    this.logger.log(`Updated point price config for ${currency}: baseRate=${baseRate}`);

    return { currency, baseRate, message: "Price config updated successfully" };
  }
}
