import { Injectable, Logger } from "@nestjs/common";
import { ValkeyService } from "../valkey.service";
import { ConfigService } from "@nestjs/config";

export type AddressNamespace = "eip155" | "solana" | "sui";

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

  private buildKey(namespace: AddressNamespace, address: string): string {
    // EVM addresses are case-insensitive on-chain — lowercase for EVM to
    // preserve existing behavior. Solana base58 is case-sensitive — use
    // the address verbatim or the set/get keys will never collide.
    const normalized = namespace === "eip155" ? address.toLowerCase() : address;
    return `nonce:${namespace}:${normalized}`;
  }

  async setNonce(
    namespaceOrAddress: AddressNamespace | string,
    addressOrNonce: string,
    maybeNonce?: string,
  ): Promise<void> {
    const { namespace, address, nonce } = this.resolveArgs(
      namespaceOrAddress,
      addressOrNonce,
      maybeNonce,
    );
    const key = this.buildKey(namespace, address);
    const ttlSeconds = this.nonceExpireMinutes * 60;
    const nonceData: NonceData = {
      nonce,
      expires: Date.now() + ttlSeconds * 1000,
    };

    await this.valkeyService.set(key, JSON.stringify(nonceData), {
      ttl: ttlSeconds,
    });
    this.logger.debug(
      `Nonce set for ${namespace}:${address} with TTL ${ttlSeconds}s`,
    );
  }

  async getNonce(
    namespaceOrAddress: AddressNamespace | string,
    maybeAddress?: string,
  ): Promise<NonceData | null> {
    const { namespace, address } = this.resolveLookupArgs(
      namespaceOrAddress,
      maybeAddress,
    );
    const key = this.buildKey(namespace, address);
    const data = await this.valkeyService.get<NonceData>(key);

    if (!data) {
      return null;
    }

    try {
      const nonceData: NonceData = data;

      if (nonceData.expires < Date.now()) {
        await this.deleteNonce(namespace, address);
        return null;
      }

      return nonceData;
    } catch (error) {
      this.logger.error(
        `Failed to parse nonce data for ${namespace}:${address}:`,
        error,
      );
      await this.deleteNonce(namespace, address);
      return null;
    }
  }

  async deleteNonce(
    namespaceOrAddress: AddressNamespace | string,
    maybeAddress?: string,
  ): Promise<void> {
    const { namespace, address } = this.resolveLookupArgs(
      namespaceOrAddress,
      maybeAddress,
    );
    const key = this.buildKey(namespace, address);
    await this.valkeyService.del(key);
    this.logger.debug(`Nonce deleted for ${namespace}:${address}`);
  }

  private resolveArgs(
    namespaceOrAddress: AddressNamespace | string,
    addressOrNonce: string,
    maybeNonce?: string,
  ): { namespace: AddressNamespace; address: string; nonce: string } {
    if (maybeNonce !== undefined) {
      return {
        namespace: namespaceOrAddress as AddressNamespace,
        address: addressOrNonce,
        nonce: maybeNonce,
      };
    }
    // Legacy (address, nonce) signature — defaults to EVM.
    // TODO(task-10): remove once all call sites pass an explicit namespace.
    return {
      namespace: "eip155",
      address: namespaceOrAddress,
      nonce: addressOrNonce,
    };
  }

  private resolveLookupArgs(
    namespaceOrAddress: AddressNamespace | string,
    maybeAddress?: string,
  ): { namespace: AddressNamespace; address: string } {
    if (maybeAddress !== undefined) {
      return {
        namespace: namespaceOrAddress as AddressNamespace,
        address: maybeAddress,
      };
    }
    // Legacy (address)-only signature — defaults to EVM.
    // TODO(task-10): remove once all call sites pass an explicit namespace.
    return { namespace: "eip155", address: namespaceOrAddress };
  }
}
