import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GlideClient, GlideString } from '@valkey/valkey-glide';
import { ValkeyConfig, CacheOptions } from './interfaces/valkey-config.interface';

@Injectable()
export class ValkeyService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ValkeyService.name);
  private client: GlideClient | null = null;
  private readonly config: ValkeyConfig;
  private connectionPromise: Promise<void> | null = null;
  private isConnected: boolean = false;

  constructor(private configService: ConfigService) {
    this.config = {
      addresses: [
        {
          host: this.configService.get<string>('VALKEY_HOST', 'localhost'),
          port: this.configService.get<number>('VALKEY_PORT', 6379),
        },
      ],
    };
  }

  async onModuleInit() {
    this.connectionPromise = this.initializeConnection();
    await this.connectionPromise;
  }

  private async initializeConnection(): Promise<void> {
    try {
      const clientConfig = {
        addresses: this.config.addresses,
        requestTimeout: this.config.requestTimeout || 5000,
      };

      this.logger.log(`Attempting to connect to Valkey at ${this.config.addresses[0].host}:${this.config.addresses[0].port}`);
      this.logger.log(`Client config: ${JSON.stringify(clientConfig, null, 2)}`);

      this.client = await GlideClient.createClient(clientConfig);
      this.logger.log('Valkey client connected successfully');

      const pong = await this.client.customCommand(['PING']);
      this.logger.log(`Valkey connection test: ${pong}`);

      this.isConnected = true;
    } catch (error) {
      this.logger.error('Failed to connect to Valkey', error);
      this.logger.warn('Valkey service will operate in fallback mode (database only)');
      this.client = null;
      this.isConnected = false;
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.close();
      this.logger.log('Valkey client disconnected');
    }
  }

  isReady(): boolean {
    return this.isConnected && this.client !== null;
  }

  async waitForConnection(timeoutMs: number = 10000): Promise<boolean> {
    if (this.isReady()) {
      return true;
    }

    if (!this.connectionPromise) {
      return false;
    }

    try {
      await Promise.race([
        this.connectionPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Connection timeout')), timeoutMs)
        )
      ]);
      return this.isReady();
    } catch (error) {
      this.logger.warn(`Failed to wait for Valkey connection: ${error.message}`);
      return false;
    }
  }

  private glideStringToString(value: GlideString | null): string | null {
    if (value === null) return null;
    return typeof value === 'string' ? value : value.toString();
  }

  async set(key: string, value: string | number | object, options?: CacheOptions): Promise<boolean> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      const serializedValue = typeof value === 'object' ? JSON.stringify(value) : String(value);

      if (options?.ttl) {
        const result = await this.client.set(key, serializedValue);
        if (result === 'OK') {
          await this.client.expire(key, options.ttl);
        }
        return result === 'OK';
      }

      const result = await this.client.set(key, serializedValue);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to set key ${key}`, error);
      throw error;
    }
  }

  async get<T = string>(key: string): Promise<T | null> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      const value = await this.client.get(key);
      const stringValue = this.glideStringToString(value);

      if (stringValue === null) {
        return null;
      }

      try {
        return JSON.parse(stringValue) as T;
      } catch {
        return stringValue as T;
      }
    } catch (error) {
      this.logger.error(`Failed to get key ${key}`, error);
      throw error;
    }
  }

  async del(key: string): Promise<number> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.del([key]);
    } catch (error) {
      this.logger.error(`Failed to delete key ${key}`, error);
      throw error;
    }
  }

  async exists(key: string): Promise<boolean> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      const result = await this.client.exists([key]);
      return result > 0;
    } catch (error) {
      this.logger.error(`Failed to check existence of key ${key}`, error);
      throw error;
    }
  }

  async expire(key: string, seconds: number): Promise<boolean> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.expire(key, seconds);
    } catch (error) {
      this.logger.error(`Failed to set expiration for key ${key}`, error);
      throw error;
    }
  }

  async ttl(key: string): Promise<number> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.ttl(key);
    } catch (error) {
      this.logger.error(`Failed to get TTL for key ${key}`, error);
      throw error;
    }
  }

  async incr(key: string): Promise<number> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.incr(key);
    } catch (error) {
      this.logger.error(`Failed to increment key ${key}`, error);
      throw error;
    }
  }

  async decr(key: string): Promise<number> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.decr(key);
    } catch (error) {
      this.logger.error(`Failed to decrement key ${key}`, error);
      throw error;
    }
  }

  async mget(keys: string[]): Promise<(string | null)[]> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      const values = await this.client.mget(keys);
      return values.map(value => this.glideStringToString(value));
    } catch (error) {
      this.logger.error(`Failed to get multiple keys`, error);
      throw error;
    }
  }

  async mset(keyValuePairs: Record<string, string | number | object>): Promise<boolean> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      const keyValueMap: Record<string, string> = {};

      for (const [key, value] of Object.entries(keyValuePairs)) {
        keyValueMap[key] = typeof value === 'object' ? JSON.stringify(value) : String(value);
      }

      const result = await this.client.mset(keyValueMap);
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Failed to set multiple keys`, error);
      throw error;
    }
  }

  async customCommand(command: string[]): Promise<any> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.customCommand(command);
    } catch (error) {
      this.logger.error(`Failed to execute custom command: ${command.join(' ')}`, error);
      throw error;
    }
  }

  async flushdb(): Promise<string> {
    if (!this.client) {
      this.logger.error('Valkey client is not initialized');
      throw new Error('Valkey client is not initialized');
    }

    try {
      return await this.client.flushdb();
    } catch (error) {
      this.logger.error('Failed to flush database', error);
      throw error;
    }
  }
}
