export interface ValkeyAddress {
  host: string;
  port: number;
}

export interface ValkeyConfig {
  addresses: ValkeyAddress[];
  useTLS?: boolean;
  requestTimeout?: number;
  clientName?: string;
}

export interface CacheOptions {
  ttl?: number;
  key?: string;
}
