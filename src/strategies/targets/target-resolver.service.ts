/**
 * TargetResolverService — Nest wrapper around the resolver registry
 * (spec §3.3, §5, §11 Q4).
 *
 * Runs at poll/score time (addresses are stable), off the request path. It
 * owns:
 *   - the ResolverContext the family resolvers consume (Valkey-cached +
 *     inflight-deduped protocol-API fetches, on-chain validation),
 *   - the single `resolve(pool)` entry the score worker calls.
 *
 * Resolved targets are persisted on `OpportunityCache.depositTarget` (the DB
 * column) AND surface through the Valkey row-cache in StrategiesService
 * (spec Q4 — cache on Valkey too). Vault-list fetches are Valkey-cached here
 * so per-pool scoring jobs don't each hit the protocol API.
 */

import { Injectable, Logger } from "@nestjs/common";
import { ValkeyService } from "../../valkey/valkey.service";
import type { DeFiLlamaYieldPool } from "../external/defillama.client";
import { bootTargetResolvers } from "./bootstrap";
import { resolveTarget } from "./registry";
import type { DepositTarget, ResolverContext } from "./types";
import { validateTarget } from "./validation";

const FETCH_TIMEOUT_MS = 20_000;

@Injectable()
export class TargetResolverService {
  private readonly logger = new Logger(TargetResolverService.name);
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly ctx: ResolverContext;

  constructor(private readonly valkey: ValkeyService) {
    bootTargetResolvers();
    this.ctx = {
      fetchJsonCached: (cacheKey, url, ttlSec, init) =>
        this.fetchJsonCached(cacheKey, url, ttlSec, init),
      validate: (target, pool) => validateTarget(target, pool),
    };
  }

  /**
   * Resolve a pool's on-chain deposit target, or `null` (→ manual). Never
   * throws — a resolver blowup degrades the pool to manual, correct-by-default.
   */
  async resolve(pool: DeFiLlamaYieldPool): Promise<DepositTarget | null> {
    try {
      return await resolveTarget(pool, this.ctx);
    } catch (err) {
      this.logger.warn(
        `[resolve] pool=${pool.pool} project=${pool.project} failed: ${
          (err as Error)?.message ?? err
        } — degrading to manual`,
      );
      return null;
    }
  }

  /** Valkey-cached + inflight-deduped JSON GET/POST. Returns null on failure. */
  private async fetchJsonCached<T>(
    cacheKey: string,
    url: string,
    ttlSec: number,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<T | null> {
    const cached = await this.valkey.get<T>(cacheKey).catch(() => null);
    if (cached !== null && cached !== undefined) return cached;

    const existing = this.inflight.get(cacheKey);
    if (existing) return existing as Promise<T | null>;

    const task = (async (): Promise<T | null> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, {
          method: init?.method ?? "GET",
          headers: init?.headers ?? { Accept: "application/json" },
          body: init?.body,
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger.warn(`[fetchJsonCached] ${url} -> HTTP ${res.status}`);
          return null;
        }
        const json = (await res.json()) as T;
        await this.valkey
          .set(cacheKey, json as object, { ttl: ttlSec })
          .catch(() => undefined);
        return json;
      } catch (err) {
        this.logger.warn(
          `[fetchJsonCached] ${url} failed: ${(err as Error)?.message ?? err}`,
        );
        return null;
      } finally {
        clearTimeout(timer);
        this.inflight.delete(cacheKey);
      }
    })();
    this.inflight.set(cacheKey, task);
    return task;
  }
}
