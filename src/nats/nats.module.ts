import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NatsService } from './nats.service';

/**
 * Global NATS module — imported once in AppModule, available everywhere.
 *
 * Used for:
 *  - Cross-pod L1 cache invalidation (API key in-memory cache)
 *  - Domain event broadcasting (purchase.completed, booking.expired)
 *
 * NATS Core (no JetStream) is sufficient here because:
 *  - Cache invalidation is fire-and-forget (at-most-once delivery is fine —
 *    worst case a pod serves stale L1 data for up to the TTL duration)
 *  - The shared Valkey layer already provides durable cross-pod cache state
 *
 * Use JetStream when you need durable event processing (e.g. email on purchase,
 * analytics pipeline) where at-least-once delivery and consumer replay matter.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [NatsService],
  exports: [NatsService],
})
export class NatsModule {}
