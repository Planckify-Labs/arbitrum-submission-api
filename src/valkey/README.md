# TakumiPay Caching System

Comprehensive caching solution using Valkey (Redis-compatible) for read-heavy operations.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Caching Patterns](#caching-patterns)
3. [Services](#services)
4. [Usage Examples](#usage-examples)
5. [Automatic Cache Invalidation](#automatic-cache-invalidation)
6. [Best Practices](#best-practices)
7. [Monitoring & Debugging](#monitoring--debugging)

---

## Architecture Overview

### Components

```
┌─────────────────────────────────────────────────────────────┐
│                   Application Layer                         │
│  (Products Service, Exchange Rate Service, Booking Service) │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│              Domain-Specific Cache Services                 │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   Product    │ │ Exchange Rate│ │   Booking    │       │
│  │    Cache     │ │    Cache     │ │    Cache     │       │
│  └──────────────┘ └──────────────┘ └──────────────┘       │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                  Cache Manager Service                      │
│  (Generic caching utilities, patterns, batch operations)    │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                     Valkey Service                          │
│              (Low-level Valkey client)                      │
└────────────────┬────────────────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────────────────┐
│                    Valkey Instance                          │
│                  (Redis-compatible)                         │
└─────────────────────────────────────────────────────────────┘
```

### Automatic Invalidation Flow

```
Database Write Operation (Prisma)
        │
        ▼
Prisma Middleware Intercepts
        │
        ▼
Cache Invalidation Service
        │
        ├──> Pattern Matching (product:*, category:*, etc.)
        │
        ├──> SCAN Keys (cursor-based)
        │
        └──> DEL Keys (batch delete)
```

---

## Caching Patterns

### 1. Cache-Aside (Lazy Loading)

**When to use**: Semi-static data that changes occasionally (products, categories)

**How it works**:
1. Check cache first
2. If miss, fetch from database
3. Store result in cache
4. Return data

**Example**:
```typescript
// Using cache service
const product = await this.productCacheService.getProductDetails(
  productId,
  async () => {
    // Fallback to database
    return this.prisma.product.findUnique({
      where: { id: productId },
      include: { prices: true, variants: true },
    });
  },
);
```

**Pros**: Simple, cache only what's needed
**Cons**: Initial request is slow (cache miss)

---

### 2. Write-Through

**When to use**: Critical data that must be consistent (vendor configs)

**How it works**:
1. Update database first
2. Update cache immediately
3. Return result

**Example**:
```typescript
// Update database and cache together
const updatedBooking = await this.bookingCacheService.updateBooking(
  bookingId,
  async () => {
    return this.prisma.bookingOrder.update({
      where: { id: bookingId },
      data: { status: 'EXECUTED' },
    });
  },
);
```

**Pros**: Cache always up-to-date
**Cons**: Slower writes (two operations)

---

### 3. TTL-Based (Time-To-Live)

**When to use**: External data that updates frequently (exchange rates)

**How it works**:
1. Cache with expiration time
2. Auto-refresh on expiry
3. No manual invalidation needed

**Example**:
```typescript
// Exchange rate cached for 5 minutes
const rate = await this.exchangeRateCacheService.getLatestRate(
  'USD',
  'USDT',
  async () => {
    return this.prisma.exchangeRate.findFirst({
      where: { fromCurrency: 'USD', toCurrency: 'USDT' },
      orderBy: { createdAt: 'desc' },
    });
  },
);
// Automatically expires after 300 seconds
```

**Pros**: Self-maintaining, no stale data concerns
**Cons**: May serve slightly outdated data

---

### 4. Automatic Invalidation (Prisma Middleware)

**When to use**: All write operations

**How it works**:
1. Prisma middleware intercepts all mutations
2. Automatically invalidates related cache patterns
3. Next read fetches fresh data

**Example**:
```typescript
// When you update a product, Prisma middleware automatically invalidates:
// - product:{id}:*
// - products:*
// - catalog:*
// - category:*:products

await this.prisma.product.update({
  where: { id: 123 },
  data: { name: 'New Name' },
});
// No manual cache invalidation needed!
```

**Pros**: Zero-effort, can't forget to invalidate
**Cons**: May invalidate more than necessary

---

## Services

### CacheManagerService

Generic cache manager with utilities for all patterns.

**Key Methods**:

```typescript
// Cache-aside pattern
cacheAside<T>(key, fallback, config?: { ttl, prefix })

// Direct operations
set<T>(key, data, ttl?)
get<T>(key)
mget<T>(keys) // Batch get
mset<T>(entries, ttl?) // Batch set

// Invalidation
invalidate(key)
invalidatePattern(pattern) // e.g., 'product:*'
invalidateKeys(keys)

// Utilities
exists(key)
getTTL(key)
refreshTTL(key, ttl)
increment(key, amount?)
decrement(key, amount?)
```

**Example**:
```typescript
constructor(private readonly cacheManager: CacheManagerService) {}

async getCustomData(id: number) {
  return this.cacheManager.cacheAside(
    `custom:${id}`,
    async () => this.fetchFromDB(id),
    { ttl: 600 }
  );
}
```

---

### ProductCacheService

Product-specific caching with optimized TTLs.

**Cache Keys**:
- `product:{id}:details` - Full product (1h TTL)
- `product:{id}:prices` - Prices only (1h TTL)
- `product:{id}:variants` - Variants only (1h TTL)
- `products:all:page:{cursor}` - Paginated list (30m TTL)
- `catalog:grouped` - Homepage catalog (1h TTL)
- `category:{categoryId}:products` - Category products (1h TTL)
- `product:code:{code}` - Product by code (1h TTL)

**Example**:
```typescript
constructor(private readonly productCache: ProductCacheService) {}

async findOne(id: number) {
  return this.productCache.getProductDetails(id, async () => {
    return this.prisma.product.findUnique({
      where: { id },
      include: { prices: true, variants: true, vendor: true },
    });
  });
}

// Batch get multiple products efficiently
async findMany(ids: number[]) {
  return this.productCache.batchGetProducts(ids, async (missingIds) => {
    const products = await this.prisma.product.findMany({
      where: { id: { in: missingIds } },
    });

    const map = new Map();
    products.forEach(p => map.set(p.id, p));
    return map;
  });
}

// Warm up cache on app startup
async onModuleInit() {
  const popularProductIds = [1, 2, 3, 5, 8]; // Your popular products
  await this.productCache.warmUpCache(popularProductIds, async (ids) => {
    const products = await this.prisma.product.findMany({
      where: { id: { in: ids } },
    });

    const map = new Map();
    products.forEach(p => map.set(p.id, p));
    return map;
  });
}
```

---

### ExchangeRateCacheService

Exchange rate caching with short TTLs for fresh data.

**Cache Keys**:
- `exchange-rate:latest:{FROM}:{TO}` - Latest rate (5m TTL)
- `exchange-rate:{id}` - Specific rate (1h TTL)
- `exchange-rate:average:{FROM}:{TO}:{days}` - Average rate (10m TTL)

**Example**:
```typescript
constructor(private readonly exchangeRateCache: ExchangeRateCacheService) {}

async findLatest(fromCurrency: string, toCurrency: string) {
  return this.exchangeRateCache.getLatestRate(
    fromCurrency,
    toCurrency,
    async () => {
      return this.prisma.exchangeRate.findFirst({
        where: { fromCurrency, toCurrency },
        orderBy: { createdAt: 'desc' },
      });
    },
  );
}

// Batch get multiple currency pairs
async findLatestRates(pairs: Array<{ from: string; to: string }>) {
  return this.exchangeRateCache.batchGetLatestRates(
    pairs,
    async (missingPairs) => {
      const rates = await Promise.all(
        missingPairs.map(pair =>
          this.prisma.exchangeRate.findFirst({
            where: { fromCurrency: pair.from, toCurrency: pair.to },
            orderBy: { createdAt: 'desc' },
          })
        )
      );

      const map = new Map();
      missingPairs.forEach((pair, i) => {
        const key = `exchange-rate:latest:${pair.from}:${pair.to}`;
        map.set(key, rates[i]);
      });
      return map;
    },
  );
}

// After fetching rates from external provider
async updateRatesFromProvider(rates: ExchangeRate[]) {
  await this.prisma.exchangeRate.createMany({ data: rates });

  // Invalidate all latest rates to force refresh
  await this.exchangeRateCache.invalidateAllLatestRates();
}
```

---

### BookingCacheService

Booking caching with very short TTLs (data changes frequently).

**Cache Keys**:
- `booking:{id}` - Specific booking (5m TTL)
- `booking:ref:{refId}` - Booking by reference (5m TTL)
- `user:{walletAddress}:bookings:latest` - Latest booking (1m TTL)
- `user:{walletAddress}:bookings:pending` - Pending bookings (3m TTL)

**Example**:
```typescript
constructor(private readonly bookingCache: BookingCacheService) {}

async getLatestBooking(walletAddress: string) {
  return this.bookingCache.getLatestBooking(walletAddress, async () => {
    return this.prisma.bookingOrder.findFirst({
      where: {
        user: { walletAddress },
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
  });
}

// After creating booking
async createBooking(data: CreateBookingDto) {
  const booking = await this.prisma.bookingOrder.create({ data });

  // Cache the newly created booking
  await this.bookingCache.setBooking(booking);

  return booking;
}

// After status update
async markBookingExecuted(bookingId: number) {
  const booking = await this.prisma.bookingOrder.update({
    where: { id: bookingId },
    data: { status: 'EXECUTED' },
  });

  // Invalidate cache for this booking and user
  await this.bookingCache.invalidateBooking(
    bookingId,
    booking.user.walletAddress,
  );

  return booking;
}

// After batch expiry job
async expireBookings(bookingIds: number[]) {
  await this.prisma.bookingOrder.updateMany({
    where: { id: { in: bookingIds } },
    data: { status: 'EXPIRED' },
  });

  // Batch invalidate all affected bookings
  await this.bookingCache.batchInvalidateBookings(bookingIds);
}
```

---

### CacheInvalidationService

Automatic cache invalidation via Prisma middleware.

**How it works**:
1. Registers invalidation rules for each Prisma model
2. Intercepts all write operations (`create`, `update`, `delete`, etc.)
3. Automatically invalidates related cache patterns

**Configuration**: See [cache-invalidation.service.ts](./services/cache-invalidation.service.ts) `initializeRules()`

**Manual invalidation**:
```typescript
constructor(private readonly cacheInvalidation: CacheInvalidationService) {}

// Invalidate by pattern
await this.cacheInvalidation.invalidateByPattern('custom-pattern:*');

// Invalidate by exact key
await this.cacheInvalidation.invalidateByKey('custom-key');

// Add custom rule at runtime
this.cacheInvalidation.addRule({
  models: ['CustomModel'],
  operations: ['create', 'update'],
  patterns: ['custom:*'],
});
```

---

## Usage Examples

### Example 1: Products Service Integration

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProductCacheService } from '../valkey/services/product-cache.service';

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly productCache: ProductCacheService,
  ) {}

  /**
   * Get product with caching
   */
  async findOne(id: number) {
    return this.productCache.getProductDetails(id, async () => {
      return this.prisma.product.findUnique({
        where: { id },
        include: {
          prices: true,
          variants: true,
          vendor: true,
          category: true,
        },
      });
    });
  }

  /**
   * Get catalog (homepage view) with caching
   */
  async findAllGroupedByCategories(limit = 6) {
    return this.productCache.getCatalogGrouped(async () => {
      const categories = await this.prisma.productCategory.findMany({
        include: {
          products: {
            take: limit,
            include: { prices: true },
          },
        },
      });
      return categories;
    });
  }

  /**
   * Update product - cache automatically invalidated by Prisma middleware
   */
  async update(id: number, updateData: UpdateProductDto) {
    // Prisma middleware will automatically invalidate:
    // - product:{id}:*
    // - products:*
    // - catalog:*
    return this.prisma.product.update({
      where: { id },
      data: updateData,
    });
  }

  /**
   * Manual invalidation if needed
   */
  async invalidateProductCache(productId?: number) {
    await this.productCache.invalidateProduct(productId);
  }
}
```

---

### Example 2: Exchange Rate Service Integration

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { ExchangeRateCacheService } from '../valkey/services/exchange-rate-cache.service';

@Injectable()
export class ExchangeRateService {
  private readonly logger = new Logger(ExchangeRateService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly exchangeRateCache: ExchangeRateCacheService,
  ) {}

  /**
   * Get latest rate with caching (5m TTL)
   */
  async findLatest(fromCurrency: string, toCurrency: string) {
    return this.exchangeRateCache.getLatestRate(
      fromCurrency,
      toCurrency,
      async () => {
        return this.prisma.exchangeRate.findFirst({
          where: {
            fromCurrency: fromCurrency.toUpperCase(),
            toCurrency: toCurrency.toUpperCase(),
          },
          orderBy: { createdAt: 'desc' },
        });
      },
    );
  }

  /**
   * Cron job to fetch rates from external provider
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async fetchRatesFromProvider() {
    this.logger.log('Fetching exchange rates from external provider...');

    try {
      // Fetch from external API (e.g., CoinGecko, Binance)
      const rates = await this.fetchFromExternalAPI();

      // Save to database
      await this.prisma.exchangeRate.createMany({
        data: rates,
        skipDuplicates: true,
      });

      // Invalidate all latest rates to force cache refresh
      await this.exchangeRateCache.invalidateAllLatestRates();

      this.logger.log(`Updated ${rates.length} exchange rates`);
    } catch (error) {
      this.logger.error(`Failed to fetch rates: ${error.message}`);
    }
  }

  private async fetchFromExternalAPI() {
    // Implementation details...
    return [];
  }
}
```

---

### Example 3: Booking Service Integration

```typescript
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BookingCacheService } from '../valkey/services/booking-cache.service';

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bookingCache: BookingCacheService,
  ) {}

  /**
   * Get latest pending booking for user
   */
  async getLatestBooking(walletAddress: string) {
    return this.bookingCache.getLatestBooking(walletAddress, async () => {
      return this.prisma.bookingOrder.findFirst({
        where: {
          user: { walletAddress },
          status: 'PENDING',
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: 'desc' },
        include: {
          product: true,
          token: true,
          blockchain: true,
        },
      });
    });
  }

  /**
   * Create booking and cache it
   */
  async createBooking(data: CreateBookingDto) {
    const booking = await this.prisma.bookingOrder.create({
      data,
      include: {
        product: true,
        token: true,
        blockchain: true,
      },
    });

    // Immediately cache the new booking
    await this.bookingCache.setBooking(booking);

    return booking;
  }

  /**
   * Mark booking as executed
   */
  async markBookingExecuted(bookingId: number, walletAddress: string) {
    const booking = await this.prisma.bookingOrder.update({
      where: { id: bookingId },
      data: {
        status: 'EXECUTED',
        executedAt: new Date(),
      },
    });

    // Invalidate cache for this booking and user's bookings
    await this.bookingCache.invalidateBooking(bookingId, walletAddress);

    return booking;
  }

  /**
   * Batch expire bookings (cron job)
   */
  async expireBookings() {
    const expiredBookings = await this.prisma.bookingOrder.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
      select: { id: true },
    });

    if (expiredBookings.length === 0) return;

    const bookingIds = expiredBookings.map(b => b.id);

    // Update status
    await this.prisma.bookingOrder.updateMany({
      where: { id: { in: bookingIds } },
      data: { status: 'EXPIRED' },
    });

    // Batch invalidate cache
    await this.bookingCache.batchInvalidateBookings(bookingIds);
  }
}
```

---

### Example 4: Using Cache Decorator

```typescript
import { Injectable, UseInterceptors } from '@nestjs/common';
import { Cacheable } from '../valkey/decorators/cache.decorator';
import { CacheInterceptor } from '../valkey/interceptors/cache.interceptor';

@Injectable()
@UseInterceptors(CacheInterceptor) // Enable caching for all methods
export class MyService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Cache product by ID
   * Key: product:{id}:details
   * TTL: 3600 seconds (1 hour)
   */
  @Cacheable('product:{0}:details', 3600)
  async getProduct(id: number) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { prices: true },
    });
  }

  /**
   * Cache user bookings
   * Key: user:{walletAddress}:bookings
   * TTL: 300 seconds (5 minutes)
   */
  @Cacheable('user:{walletAddress}:bookings', 300)
  async getUserBookings({ walletAddress }: { walletAddress: string }) {
    return this.prisma.bookingOrder.findMany({
      where: { user: { walletAddress } },
    });
  }

  /**
   * Cache with multiple arguments
   * Key: rate:USD:USDT
   */
  @Cacheable('rate:{0}:{1}', 300)
  async getExchangeRate(fromCurrency: string, toCurrency: string) {
    return this.prisma.exchangeRate.findFirst({
      where: { fromCurrency, toCurrency },
      orderBy: { createdAt: 'desc' },
    });
  }
}
```

---

## Automatic Cache Invalidation

### How It Works

1. **Prisma Middleware** intercepts all write operations
2. **Cache Invalidation Service** matches operation to invalidation rules
3. **Patterns** are invalidated automatically

### Invalidation Rules (Pre-configured)

| Model | Operations | Invalidated Patterns |
|-------|-----------|---------------------|
| `Product` | create, update, delete | `product:*`, `products:*`, `catalog:*`, `category:*:products` |
| `ProductPrice` | create, update, delete | `product:*:prices`, `product:*:details`, `products:*` |
| `ProductVariant` | create, update, delete | `product:*:variants`, `product:*:details`, `products:*` |
| `ProductCategory` | create, update, delete | `category:*`, `catalog:*`, `categories:*` |
| `ExchangeRate` | create, update, delete | `exchange-rate:*`, `latest-rate:*` |
| `BookingOrder` | create, update, delete | `booking:*`, `user:*:bookings` |
| `Purchase` | create, update, delete | `purchase:*`, `user:*:purchases`, `transaction:*` |
| `TransactionHistory` | create, update, delete | `transaction:*`, `user:*:transactions` |
| `Blockchain`, `Token` | create, update, delete | `blockchain:*`, `token:*`, `supported-chains` |
| `VendorAPI` | create, update, delete | `vendorApi:*` |
| `User` | create, update, delete | `user:*:profile`, `user:*:bookings`, `user:*:purchases` |

### Example: Automatic Invalidation in Action

```typescript
// When you update a product...
await this.prisma.product.update({
  where: { id: 123 },
  data: { name: 'Updated Product Name' },
});

// Prisma middleware automatically invalidates:
// ✅ product:123:*
// ✅ products:*
// ✅ catalog:*
// ✅ category:*:products

// Next read will fetch fresh data from database
const product = await this.productCache.getProductDetails(123, ...);
// Cache MISS -> Fetches from DB -> Caches fresh data
```

---

## Best Practices

### 1. Choose the Right TTL

| Data Type | Recommended TTL | Reasoning |
|-----------|----------------|-----------|
| Products, Categories | 1 hour (3600s) | Changes infrequently |
| Exchange Rates | 5 minutes (300s) | External data, updates often |
| Bookings | 1-5 minutes (60-300s) | Status changes frequently |
| User Profiles | 15 minutes (900s) | Changes occasionally |
| Static Config | No TTL (persistent) | Rarely changes, invalidate manually |

### 2. Use Batch Operations

```typescript
// ❌ BAD: Multiple individual cache calls
for (const id of productIds) {
  await this.productCache.getProductDetails(id, ...);
}

// ✅ GOOD: Single batch operation
const products = await this.productCache.batchGetProducts(productIds, ...);
```

### 3. Warm Up Critical Caches

```typescript
@Injectable()
export class AppService implements OnModuleInit {
  async onModuleInit() {
    // Warm up popular products on app startup
    await this.productCache.warmUpCache([1, 2, 3, 5, 8], ...);

    // Warm up common exchange rates
    await this.exchangeRateCache.warmUpCache([
      { from: 'USD', to: 'USDT' },
      { from: 'IDR', to: 'USDT' },
    ], ...);
  }
}
```

### 4. Monitor Cache Hit Rates

```typescript
// Enable debug logging in development
VALKEY_LOG_LEVEL=debug npm run start:dev

// Look for cache HIT/MISS logs
[CacheManagerService] Cache HIT: product:123:details
[CacheManagerService] Cache MISS: product:456:details
```

### 5. Handle Cache Failures Gracefully

```typescript
// Cache services already have graceful degradation
// If Valkey is down, they fall back to database

// Example: ValkeyService automatically falls back
async get(key: string): Promise<string | null> {
  if (!this.client) {
    this.logger.warn('Valkey client not connected, skipping cache read');
    return null; // Graceful degradation
  }

  try {
    return await this.client.get(key);
  } catch (error) {
    this.logger.error(`Cache read error: ${error.message}`);
    return null; // Return null, let caller fetch from DB
  }
}
```

### 6. Invalidate Strategically

```typescript
// ✅ GOOD: Specific invalidation
await this.productCache.invalidateProduct(productId);

// ⚠️ USE SPARINGLY: Broad invalidation (expensive)
await this.cacheManager.invalidatePattern('product:*');

// ✅ BEST: Automatic invalidation via Prisma middleware
// Just update the database, cache invalidates automatically
await this.prisma.product.update({ where: { id }, data });
```

---

## Monitoring & Debugging

### Enable Debug Logging

```bash
# In .env
VALKEY_LOG_LEVEL=debug
```

### Check Cache Keys in Redis CLI

```bash
# Connect to Valkey
redis-cli -h localhost -p 6379

# List all keys
KEYS *

# List product keys only
KEYS product:*

# Get specific key
GET product:123:details

# Check TTL
TTL product:123:details

# Delete specific key
DEL product:123:details

# Delete all keys (DANGER!)
FLUSHDB
```

### Monitor Cache Hit Ratio

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

@Injectable()
export class CacheMonitorService {
  private readonly logger = new Logger(CacheMonitorService.name);
  private hits = 0;
  private misses = 0;

  recordHit() {
    this.hits++;
  }

  recordMiss() {
    this.misses++;
  }

  @Cron(CronExpression.EVERY_MINUTE)
  logStats() {
    const total = this.hits + this.misses;
    const hitRatio = total > 0 ? (this.hits / total) * 100 : 0;

    this.logger.log(
      `Cache Stats: Hits=${this.hits}, Misses=${this.misses}, Hit Ratio=${hitRatio.toFixed(2)}%`,
    );

    // Reset counters
    this.hits = 0;
    this.misses = 0;
  }
}
```

---

## Environment Variables

```bash
# Required
VALKEY_HOST=localhost
VALKEY_PORT=6379

# Optional
VALKEY_PASSWORD=your-password
VALKEY_CONNECTION_TIMEOUT=10000 # 10 seconds
NONCE_EXPIRE_TIME_MINUTES=5
```

---

## Troubleshooting

### Cache Not Working

1. Check Valkey connection:
   ```bash
   redis-cli -h localhost -p 6379 PING
   # Should return: PONG
   ```

2. Check logs for connection errors:
   ```bash
   grep "Valkey" logs/app.log
   ```

3. Verify module is imported:
   ```typescript
   @Module({
     imports: [ValkeyModule], // Must be imported
   })
   ```

### Stale Cache Data

1. Check if automatic invalidation is working:
   ```typescript
   // Verify middleware is registered
   await this.prismaService.setCacheInvalidationService(...)
   ```

2. Manual invalidation:
   ```typescript
   await this.cacheManager.invalidatePattern('product:*');
   ```

3. Clear all cache (nuclear option):
   ```bash
   redis-cli FLUSHDB
   ```

### High Memory Usage

1. Check key count:
   ```bash
   redis-cli DBSIZE
   ```

2. Find large keys:
   ```bash
   redis-cli --bigkeys
   ```

3. Set eviction policy in Valkey config:
   ```conf
   maxmemory 256mb
   maxmemory-policy allkeys-lru
   ```

---

## Summary

This caching system provides:

✅ **Multiple caching patterns** (cache-aside, write-through, TTL-based)
✅ **Domain-specific services** (products, exchange rates, bookings)
✅ **Automatic invalidation** (Prisma middleware)
✅ **Batch operations** (efficient multi-key operations)
✅ **Graceful degradation** (falls back to DB if cache fails)
✅ **Easy integration** (inject services, call methods)
✅ **Monitoring & debugging** (comprehensive logging)

For questions or issues, check the logs or contact the backend team.
