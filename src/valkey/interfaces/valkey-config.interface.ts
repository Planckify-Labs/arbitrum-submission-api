export interface ValkeyAddress {
  host: string;
  port: number;
}

export interface ValkeyCredentials {
  password: string;
  username?: string;
}

export interface ValkeyConfig {
  addresses: ValkeyAddress[];
  useTLS?: boolean;
  requestTimeout?: number;
  clientName?: string;
  credentials?: ValkeyCredentials;
}

export interface CacheOptions {
  ttl?: number;
  key?: string;
}
