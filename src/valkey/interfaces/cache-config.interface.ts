export interface TCacheConfig {
  ttl?: number; // TTL in seconds
  prefix?: string; // Key prefix
  enableCompression?: boolean; // For large objects
}

export interface TCacheInvalidationConfig {
  pattern?: string; // Pattern to match keys for invalidation
  keys?: string[]; // Specific keys to invalidate
  model?: string; // Prisma model name
}

export enum CacheStrategy {
  CACHE_ASIDE = 'cache_aside',
  WRITE_THROUGH = 'write_through',
  WRITE_BEHIND = 'write_behind',
  TTL_BASED = 'ttl_based',
}

export interface TCacheMetadata {
  cachedAt: number;
  expiresAt?: number;
  version?: string;
}

export interface TCachedData<T> {
  data: T;
  metadata: TCacheMetadata;
}

export interface TCacheKeyBuilder {
  buildKey(...parts: (string | number)[]): string;
  buildPattern(pattern: string): string;
}
