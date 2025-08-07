import {
  Injectable,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReferenceIdStatus } from "@generated/prisma";

export interface ReferenceIdMetadata
  extends Record<string, string | number | boolean | null | undefined> {
  bookingId?: string;
  purchaseId?: string;
  walletAddress?: string;
}

@Injectable()
export class ReferenceIdService {
  constructor(private readonly prisma: PrismaService) {}

  private validateRefIdFormat(refId: string): void {
    if (!refId || refId.trim() === "") {
      throw new BadRequestException("Reference ID cannot be empty");
    }
  }

  async validateUniqueRefId(refId: string): Promise<void> {
    this.validateRefIdFormat(refId);

    const existingRefId = await this.prisma.referenceId.findUnique({
      where: { refId },
    });

    if (existingRefId) {
      throw new ConflictException(
        `Reference ID '${refId}' has already been processed. Status: ${existingRefId.status}`,
      );
    }
  }

  async updateReferenceIdStatus(
    refId: string,
    status: ReferenceIdStatus,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    const updateData: {
      status: ReferenceIdStatus;
      metadata?: ReferenceIdMetadata;
    } = { status };

    if (metadata) {
      const existing = await this.prisma.referenceId.findUnique({
        where: { refId },
        select: { metadata: true },
      });

      if (existing) {
        updateData.metadata = {
          ...((existing.metadata as object) || {}),
          ...metadata,
        };
      } else {
        updateData.metadata = metadata;
      }
    }

    await this.prisma.referenceId.update({
      where: { refId },
      data: updateData,
    });
  }

  async getReferenceIdStatus(refId: string) {
    return await this.prisma.referenceId.findUnique({
      where: { refId },
    });
  }

  async markAsProcessing(
    refId: string,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    await this.updateReferenceIdStatus(
      refId,
      ReferenceIdStatus.PROCESSING,
      metadata,
    );
  }

  async markAsCompleted(
    refId: string,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    await this.updateReferenceIdStatus(
      refId,
      ReferenceIdStatus.COMPLETED,
      metadata,
    );
  }

  async markAsFailed(
    refId: string,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    await this.updateReferenceIdStatus(
      refId,
      ReferenceIdStatus.FAILED,
      metadata,
    );
  }

  async cleanupOldReferenceIds(olderThanDays: number = 30): Promise<number> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await this.prisma.referenceId.deleteMany({
      where: {
        createdAt: {
          lt: cutoffDate,
        },
        status: {
          in: [ReferenceIdStatus.COMPLETED, ReferenceIdStatus.FAILED],
        },
      },
    });

    return result.count;
  }
}
