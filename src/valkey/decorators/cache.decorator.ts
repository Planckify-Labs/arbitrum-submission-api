import { SetMetadata } from '@nestjs/common';

export const CACHE_KEY_METADATA = 'cache:key';
export const CACHE_TTL_METADATA = 'cache:ttl';
export const INVALIDATE_CACHE_METADATA = 'cache:invalidate';

/**
 * Cache decorator for method-level caching
 *
 * Usage:
 * ```typescript
 * @Cacheable('product:details', 3600)
 * async getProductDetails(id: number) {
 *   return this.prisma.product.findUnique({ where: { id } });
 * }
 * ```
 *
 * The key can include placeholders for method arguments:
 * - {0}, {1}, etc. for positional arguments
 * - {argName} for named arguments
 *
 * Example:
 * ```typescript
 * @Cacheable('product:{0}:details', 3600)
 * async getProduct(id: number) { ... }
 *
 * @Cacheable('user:{walletAddress}:bookings', 300)
 * async getUserBookings({ walletAddress }: { walletAddress: string }) { ... }
 * ```
 */
export const Cacheable = (keyPattern: string, ttl = 3600) => {
  return (
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor,
  ) => {
    SetMetadata(CACHE_KEY_METADATA, keyPattern)(target, propertyKey, descriptor);
    SetMetadata(CACHE_TTL_METADATA, ttl)(target, propertyKey, descriptor);
    return descriptor;
  };
};

/**
 * Cache invalidation decorator
 * Invalidates cache after method execution
 *
 * Usage:
 * ```typescript
 * // Single pattern
 * @InvalidateCache('product:*')
 * async updateProduct(id: number, data: UpdateProductDto) {
 *   return this.prisma.product.update({ where: { id }, data });
 * }
 *
 * // Multiple patterns
 * @InvalidateCache(['product:{0}:details', 'product:{0}:prices', 'catalog:*'])
 * async updateProduct(id: number, data: UpdateProductDto) {
 *   return this.prisma.product.update({ where: { id }, data });
 * }
 *
 * // With named placeholders
 * @InvalidateCache('user:{walletAddress}:bookings')
 * async cancelBooking({ walletAddress }: { walletAddress: string }) { ... }
 * ```
 */
export const InvalidateCache = (pattern: string | string[]) => {
  return SetMetadata(INVALIDATE_CACHE_METADATA, pattern);
};

/**
 * Build cache key from pattern and method arguments
 */
export function buildCacheKey(
  pattern: string,
  args: any[],
  argNames: string[] = [],
): string {
  let key = pattern;

  // Replace positional placeholders {0}, {1}, etc.
  args.forEach((arg, index) => {
    const placeholder = `{${index}}`;
    if (key.includes(placeholder)) {
      const value = typeof arg === 'object' ? JSON.stringify(arg) : String(arg);
      key = key.replace(placeholder, value);
    }
  });

  // Replace named placeholders {argName}
  if (args.length > 0 && typeof args[0] === 'object') {
    const firstArg = args[0];
    for (const [argName, argValue] of Object.entries(firstArg)) {
      const placeholder = `{${argName}}`;
      if (key.includes(placeholder)) {
        const value =
          typeof argValue === 'object'
            ? JSON.stringify(argValue)
            : String(argValue);
        key = key.replace(placeholder, value);
      }
    }
  }

  return key;
}
