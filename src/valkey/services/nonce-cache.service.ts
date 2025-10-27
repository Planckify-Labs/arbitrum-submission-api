import { Injectable, Logger } from "@nestjs/common";
import { ValkeyService } from "../valkey.service";
import { ConfigService } from "@nestjs/config";

interface NonceData {
  nonce: string;
  expires: number;
}

@Injectable()
export class NonceCacheService {
  private readonly logger = new Logger(NonceCacheService.name);
  private readonly nonceExpireMinutes: number;

  constructor(
    private readonly valkeyService: ValkeyService,
    private readonly configService: ConfigService,
  ) {
    this.nonceExpireMinutes = parseInt(
      this.configService.get<string>("NONCE_EXPIRE_TIME_MINUTES", "5"),
      10,
    );
  }

  async setNonce(walletAddress: string, nonce: string): Promise<void> {
    const key = `nonce:${walletAddress.toLowerCase()}`;
    const ttlSeconds = this.nonceExpireMinutes * 60;

    const nonceData: NonceData = {
      nonce,
      expires: Date.now() + ttlSeconds * 1000,
    };

    await this.valkeyService.set(key, JSON.stringify(nonceData), {
      ttl: ttlSeconds,
    });
    this.logger.debug(
      `Nonce set for wallet ${walletAddress} with TTL ${ttlSeconds}s`,
    );
  }

  async getNonce(walletAddress: string): Promise<NonceData | null> {
    const key = `nonce:${walletAddress.toLowerCase()}`;
    const data = await this.valkeyService.get<NonceData>(key);

    if (!data) {
      return null;
    }

    try {
      const nonceData: NonceData = data;

      if (nonceData.expires < Date.now()) {
        await this.deleteNonce(walletAddress);
        return null;
      }

      return nonceData;
    } catch (error) {
      this.logger.error(
        `Failed to parse nonce data for ${walletAddress}:`,
        error,
      );
      await this.deleteNonce(walletAddress);
      return null;
    }
  }

  async deleteNonce(walletAddress: string): Promise<void> {
    const key = `nonce:${walletAddress.toLowerCase()}`;
    await this.valkeyService.del(key);
    this.logger.debug(`Nonce deleted for wallet ${walletAddress}`);
  }
}
