import {
  Injectable,
  ConflictException,
  BadRequestException,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ReferenceIdStatus } from "@generated/prisma";

export interface ReferenceIdMetadata {
  bookingId?: string;
  purchaseId?: string;
  walletAddress?: string;
  [key: string]: any;
}

@Injectable()
export class ReferenceIdService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validates the reference ID format
   */
  private validateRefIdFormat(refId: string): void {
    if (!refId.startsWith("TRX-")) {
      throw new BadRequestException(
        "Reference ID must start with 'TRX-' followed by a unique identifier",
      );
    }

    if (refId.length < 5) {
      throw new BadRequestException(
        "Reference ID must have content after 'TRX-'",
      );
    }
  }

  /**
   * Checks if a reference ID already exists and throws an error if it does
   */
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

  /**
   * Creates a new reference ID record
   */
  async createReferenceId(
    refId: string,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    await this.validateUniqueRefId(refId);

    await this.prisma.referenceId.create({
      data: {
        refId,
        status: ReferenceIdStatus.PENDING,
        metadata: metadata || {},
      },
    });
  }

  /**
   * Updates the status of a reference ID
   */
  async updateReferenceIdStatus(
    refId: string,
    status: ReferenceIdStatus,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    const updateData: any = { status };

    if (metadata) {
      // Merge with existing metadata
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

  /**
   * Gets the current status of a reference ID
   */
  async getReferenceIdStatus(refId: string) {
    return await this.prisma.referenceId.findUnique({
      where: { refId },
    });
  }

  /**
   * Marks a reference ID as processing
   */
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

  /**
   * Marks a reference ID as completed
   */
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

  /**
   * Marks a reference ID as failed
   */
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

  /**
   * Validates and reserves a reference ID for processing
   * This is an atomic operation that checks uniqueness and creates the record
   */
  async validateAndReserveRefId(
    refId: string,
    metadata?: ReferenceIdMetadata,
  ): Promise<void> {
    try {
      await this.createReferenceId(refId, metadata);
    } catch (error) {
      if (error.code === "P2002") {
        // Prisma unique constraint violation
        throw new ConflictException(
          `Reference ID '${refId}' has already been processed`,
        );
      }
      throw error;
    }
  }

  /**
   * Cleanup old reference IDs (optional maintenance function)
   */
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
