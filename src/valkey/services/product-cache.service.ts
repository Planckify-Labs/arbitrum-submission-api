import { Injectable, Logger } from '@nestjs/common';
import { CacheManagerService } from './cache-manager.service';

/**
 * Product-specific caching service
 * Implements cache-aside with write-through pattern for product data
 *
 * Cache Keys:
 * - product:{id}:details - Full product with variants and prices
 * - product:{id}:prices - Product prices only
 * - product:{id}:variants - Product variants only
 * - products:all:page:{cursor} - Paginated product list
 * - catalog:grouped - Products grouped by category (homepage view)
 * - category:{categoryId}:products - Products in specific category
 * - product:code:{code} - Product lookup by code
 */
@Injectable()
export class ProductCacheService {
  private readonly logger = new Logger(ProductCacheService.name);
  private readonly TTL = {
    PRODUCT_DETAILS: 3600, // 1 hour - products rarely change
    PRODUCT_LIST: 1800, // 30 minutes - list may change more frequently
    CATALOG: 3600, // 1 hour - homepage catalog
    CATEGORY_PRODUCTS: 3600, // 1 hour - category listings
  };

  constructor(private readonly cacheManager: CacheManagerService) {}

  /**
   * Get product details with cache-aside pattern
   */
  async getProductDetails<T>(
    productId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('product', productId, 'details');
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.PRODUCT_DETAILS,
    });
  }

  /**
   * Get product prices with cache-aside pattern
   */
  async getProductPrices<T>(
    productId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('product', productId, 'prices');
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.PRODUCT_DETAILS,
    });
  }

  /**
   * Get product variants with cache-aside pattern
   */
  async getProductVariants<T>(
    productId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('product', productId, 'variants');
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.PRODUCT_DETAILS,
    });
  }

  /**
   * Get product by code with cache-aside pattern
   */
  async getProductByCode<T>(
    code: string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('product', 'code', code);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.PRODUCT_DETAILS,
    });
  }

  /**
   * Get paginated product list with cache-aside pattern
   */
  async getProductList<T>(
    cursor: string | number,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('products', 'all', 'page', cursor);
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.PRODUCT_LIST,
    });
  }

  /**
   * Get products grouped by category (catalog view)
   */
  async getCatalogGrouped<T>(fallback: () => Promise<T>): Promise<T> {
    const key = 'catalog:grouped';
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CATALOG,
    });
  }

  /**
   * Get products by category with cache-aside pattern
   */
  async getProductsByCategory<T>(
    categoryId: number | string,
    fallback: () => Promise<T>,
  ): Promise<T> {
    const key = this.cacheManager.buildKey('category', categoryId, 'products');
    return this.cacheManager.cacheAside(key, fallback, {
      ttl: this.TTL.CATEGORY_PRODUCTS,
    });
  }

  /**
   * Invalidate all product-related caches
   * Called when product is created/updated/deleted
   */
  async invalidateProduct(productId?: number | string): Promise<void> {
    const patterns = [
      'products:*', // All product lists
      'catalog:*', // Catalog views
    ];

    if (productId) {
      patterns.push(`product:${productId}:*`); // Specific product
    } else {
      patterns.push('product:*'); // All products
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(`Invalidated product cache (ID: ${productId ?? 'all'})`);
  }

  /**
   * Invalidate category-related caches
   */
  async invalidateCategory(categoryId?: number | string): Promise<void> {
    const patterns = [
      'catalog:*', // Catalog views
      'categories:*', // Category lists
    ];

    if (categoryId) {
      patterns.push(`category:${categoryId}:*`); // Specific category
    } else {
      patterns.push('category:*'); // All categories
    }

    await Promise.all(
      patterns.map((pattern) => this.cacheManager.invalidatePattern(pattern)),
    );

    this.logger.debug(`Invalidated category cache (ID: ${categoryId ?? 'all'})`);
  }

  /**
   * Batch get multiple products (efficient for lists)
   */
  async batchGetProducts<T>(
    productIds: string[],
    fallback: (missingIds: string[]) => Promise<Map<string, T>>,
  ): Promise<Map<string, T>> {
    const keys = productIds.map((id) =>
      this.cacheManager.buildKey('product', id, 'details'),
    );

    // Get cached products
    const cached = await this.cacheManager.mget<T>(keys);

    // Find missing products
    const missingIds = productIds.filter(
      (id) =>
        !cached.has(this.cacheManager.buildKey('product', id, 'details')),
    );

    if (missingIds.length === 0) {
      // All cached, return mapped result
      const result = new Map<string, T>();
      productIds.forEach((id) => {
        const key = this.cacheManager.buildKey('product', id, 'details');
        const value = cached.get(key);
        if (value) result.set(id, value);
      });
      return result;
    }

    // Fetch missing from database
    const dbResults = await fallback(missingIds);

    // Cache missing products
    const toCache = new Map<string, T>();
    for (const [id, product] of dbResults) {
      const key = this.cacheManager.buildKey('product', id, 'details');
      toCache.set(key, product);
    }

    await this.cacheManager.mset(toCache, this.TTL.PRODUCT_DETAILS);

    // Merge cached and fetched
    const result = new Map<string, T>();
    productIds.forEach((id) => {
      const cachedValue = cached.get(
        this.cacheManager.buildKey('product', id, 'details'),
      );
      const dbValue = dbResults.get(id);
      if (cachedValue) result.set(id, cachedValue);
      else if (dbValue) result.set(id, dbValue);
    });

    return result;
  }

  /**
   * Warm up cache for popular products
   * Call this on app startup or periodically
   */
  async warmUpCache<T>(
    popularProductIds: string[],
    fetcher: (ids: string[]) => Promise<Map<string, T>>,
  ): Promise<void> {
    this.logger.log(`Warming up cache for ${popularProductIds.length} products`);

    const products = await fetcher(popularProductIds);
    const toCache = new Map<string, T>();

    for (const [id, product] of products) {
      const key = this.cacheManager.buildKey('product', id, 'details');
      toCache.set(key, product);
    }

    await this.cacheManager.mset(toCache, this.TTL.PRODUCT_DETAILS);

    this.logger.log(`Cache warmed up for ${products.size} products`);
  }
}
