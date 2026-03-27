import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  connect,
  NatsConnection,
  StringCodec,
  Subscription,
  NatsError,
} from 'nats';

export interface NatsCacheInvalidationPayload {
  /** Source instance ID — receivers skip their own messages */
  instanceId: string;
  /** Valkey key patterns to invalidate (e.g. 'product:*') */
  patterns?: string[];
  /** Exact Valkey keys to delete */
  keys?: string[];
  /** L1 in-memory cache keys to evict (API keys etc.) */
  l1Keys?: string[];
}

export const NATS_SUBJECTS = {
  CACHE_INVALIDATE: 'cache.invalidate',
  PURCHASE_COMPLETED: 'events.purchase.completed',
  BOOKING_EXPIRED: 'events.booking.expired',
} as const;

@Injectable()
export class NatsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NatsService.name);
  private connection: NatsConnection | null = null;
  private readonly codec = StringCodec();
  private readonly subscriptions: Subscription[] = [];

  /** Unique ID for this process instance — used to skip self-published messages */
  readonly instanceId = `${process.pid}-${Date.now()}`;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const servers = this.configService.get<string>('NATS_SERVERS', 'nats://localhost:4222');
    const user = this.configService.get<string>('NATS_USER');
    const pass = this.configService.get<string>('NATS_PASS');

    try {
      this.connection = await connect({
        servers: servers.split(',').map((s) => s.trim()),
        ...(user && pass && { user, pass }),
        reconnect: true,
        maxReconnectAttempts: -1, // infinite
        reconnectTimeWait: 2000,
        pingInterval: 30_000,
        name: `takumipay-api-${this.instanceId}`,
      });

      this.logger.log(`NATS connected — servers: ${servers} | instanceId: ${this.instanceId}`);

      // Log disconnects / reconnects
      (async () => {
        for await (const s of this.connection!.status()) {
          this.logger.debug(`NATS status: ${s.type}`);
        }
      })().catch(() => undefined);
    } catch (error) {
      this.logger.error('Failed to connect to NATS — running without pub/sub', error);
      this.connection = null;
    }
  }

  async onModuleDestroy(): Promise<void> {
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    if (this.connection) {
      await this.connection.drain();
      this.logger.log('NATS connection drained and closed');
    }
  }

  get isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  /**
   * Publish a message to a NATS subject.
   * Fire-and-forget — never throws.
   */
  publish<T>(subject: string, payload: T): void {
    if (!this.isConnected) return;

    try {
      const data = this.codec.encode(JSON.stringify(payload));
      this.connection!.publish(subject, data);
    } catch (error) {
      this.logger.warn(`Failed to publish to ${subject}: ${(error as Error).message}`);
    }
  }

  /**
   * Subscribe to a NATS subject.
   * @param subject NATS subject (supports wildcards: 'cache.>' or 'cache.*')
   * @param handler Called for each message (never throws internally)
   */
  subscribe<T>(subject: string, handler: (payload: T) => void | Promise<void>): void {
    if (!this.isConnected) {
      this.logger.warn(`Cannot subscribe to ${subject} — NATS not connected`);
      return;
    }

    const sub = this.connection!.subscribe(subject);
    this.subscriptions.push(sub);

    (async () => {
      for await (const msg of sub) {
        try {
          const text = this.codec.decode(msg.data);
          const payload = JSON.parse(text) as T;
          await handler(payload);
        } catch (error) {
          if (!(error instanceof NatsError)) {
            this.logger.warn(`Handler error on ${subject}: ${(error as Error).message}`);
          }
        }
      }
    })().catch(() => undefined);

    this.logger.log(`Subscribed to NATS subject: ${subject}`);
  }

  /**
   * Convenience: publish a cache invalidation event to all pods.
   */
  publishCacheInvalidation(payload: Omit<NatsCacheInvalidationPayload, 'instanceId'>): void {
    this.publish<NatsCacheInvalidationPayload>(NATS_SUBJECTS.CACHE_INVALIDATE, {
      instanceId: this.instanceId,
      ...payload,
    });
  }
}
