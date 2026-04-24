import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { ValkeyService } from "../valkey/valkey.service";
import type { ChannelResponseDto } from "./dto/channel-response.dto";
import type { CreateMerchantDto } from "./dto/create-merchant.dto";
import type {
  MerchantResponseDto,
  MerchantWithQrResponseDto,
} from "./dto/merchant-response.dto";
import type { PatchMerchantDto } from "./dto/patch-merchant.dto";
import { QrSigningService } from "./qr-signing.service";

/** Valkey cache key prefix + TTL for the channels lookup (spec §6.0
 *  filter-at-source). One hour is well inside "eventual propagation" —
 *  ops flips `isActive` and expects the next hour of traffic to show
 *  the new list. A follow-up task wires explicit invalidation on the
 *  (currently SQL-only) Channel mutation path. */
export const CHANNELS_CACHE_KEY_PREFIX = "channels:";
export const CHANNELS_CACHE_TTL_SECONDS = 3600;

/**
 * Lifecycle owner for the `/v1/merchants/*` surface. Pairs with
 * `merchants.controller.ts` and delegates JWS signing to
 * `QrSigningService`.
 *
 * Three-role separation: server signs the QR, picks the kid/iat/exp, and
 * validates channel codes against the `Channel` table — client-supplied
 * values for those fields are dropped. The mobile verifier (task 05) is
 * offline and bound by the bundled public JWK kid.
 *
 * First-claim-wins on QRIS PAN is enforced inside a Prisma transaction:
 * the audit row + merchant row commit together, and the partial unique
 * index on `Merchant.qrisPan` turns the race into a P2002 which we
 * surface as a 409.
 */
@Injectable()
export class MerchantsService {
  private readonly logger = new Logger(MerchantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly qrSigning: QrSigningService,
    // `@Optional()` keeps the existing unit-test constructors (which
    // don't wire Valkey) working — the cache layer is additive for the
    // channels lookup and degrades cleanly to a DB-only read if the
    // service isn't injected (or if Valkey is down at runtime).
    @Optional() private readonly valkey?: ValkeyService,
  ) {}

  /**
   * Create the merchant row for the authenticated user + sign its JWS.
   * 409 if the QRIS PAN is already claimed. 400 on unknown channel code.
   */
  async signup(
    userId: string,
    dto: CreateMerchantDto,
  ): Promise<MerchantWithQrResponseDto> {
    // Channel validation first — if the code is bogus we fail before
    // touching the DB or the signer. Filter-at-source (memory
    // `feedback_filter_at_source.md`): the channel whitelist is the
    // `Channel` table join, not a duplicated constant.
    const channel = await this.findActiveChannel(
      dto.payoutChannel,
      dto.countryCode,
    );
    this.validateAccountFormat(dto.payoutAccountNumber, channel.accountFormat);

    // Fail-fast duplicate guards so we return sharp errors instead of
    // relying on P2002 surfaces (which are harder to map to pointer-rich
    // error bodies). The DB still has the authoritative unique, so the
    // transaction below is race-safe.
    const existingForUser = await this.prisma.merchant.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (existingForUser) {
      throw new ConflictException({
        message:
          "Merchant profile already exists for this user. Use PATCH /v1/merchants/me to update.",
        code: "MERCHANT_ALREADY_EXISTS",
      });
    }

    if (dto.qrisLink?.qrisPan) {
      const claimed = await this.prisma.merchant.findFirst({
        where: { qrisPan: dto.qrisLink.qrisPan },
        select: { id: true },
      });
      if (claimed) {
        throw new ConflictException({
          message:
            "This QRIS PAN has already been claimed by another merchant.",
          code: "QRIS_PAN_ALREADY_CLAIMED",
        });
      }
    }

    // Sign the JWS *before* the transaction so we never hold a DB write
    // lock across the synchronous crypto call. The JWS is pure function
    // of the id + name + country + (optional) qrisPan — we generate the
    // merchant id upfront (ULID) so the JWS claim matches the row we
    // will persist.
    const merchantId = generateUlid();
    const qrisPan = dto.qrisLink?.qrisPan ?? null;
    const signed = await this.qrSigning.signMerchantQr({
      merchantId,
      displayName: dto.displayName,
      country: dto.countryCode,
      qrisPan: qrisPan ?? undefined,
    });

    // Account number encryption placeholder — the column is BYTEA per
    // schema.prisma §6.6, and the long-term encryption envelope is
    // delivered by task 45 / ops. For now we persist UTF-8 bytes of the
    // plaintext so the Xendit payout service (task 29) can decrypt
    // round-trip. Callers that need true at-rest secrecy layer this
    // through pgcrypto or a KMS envelope later; the column shape is
    // unchanged.
    const accountBytes = Buffer.from(dto.payoutAccountNumber, "utf8");

    try {
      const row = await this.prisma.$transaction(async (tx) => {
        const merchant = await tx.merchant.create({
          data: {
            id: merchantId,
            userId,
            displayName: dto.displayName,
            contactPhone: dto.contactPhone ?? "",
            country: dto.countryCode,
            payoutChannelCode: dto.payoutChannel,
            payoutAccountNumber: accountBytes,
            payoutAccountHolderName: dto.payoutAccountHolderName,
            qrisPan,
            qrisStickerPhotoKey: dto.qrisLink?.stickerPhotoKey ?? null,
            jwsQr: signed.wire,
            jwsIssuedAt: new Date(signed.iat * 1000),
            jwsExpiresAt: null,
            payoutProvider: "xendit",
          },
        });

        // Audit row for the QRIS claim — written in the same tx so the
        // Merchant row and audit row commit atomically. If either
        // insert fails, neither persists.
        if (qrisPan) {
          await tx.merchantQrisClaim.create({
            data: {
              merchantId: merchant.id,
              qrisPan,
              stickerPhotoKey: dto.qrisLink?.stickerPhotoKey ?? "",
              claimedAt: new Date(),
            },
          });
        }

        return merchant;
      });

      const projection = this.toResponseDto(row);
      return { merchant: projection, jwsQr: row.jwsQr };
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        throw new ConflictException({
          message:
            "This QRIS PAN has already been claimed by another merchant.",
          code: "QRIS_PAN_ALREADY_CLAIMED",
        });
      }
      throw err;
    }
  }

  /**
   * Fetch the authenticated user's merchant profile. 404 on miss — the
   * mobile client uses the 404 to route to signup.
   */
  async findMeOrThrow(userId: string): Promise<MerchantResponseDto> {
    const row = await this.prisma.merchant.findUnique({ where: { userId } });
    if (!row) {
      throw new NotFoundException({
        message: "No merchant profile for this user.",
        code: "MERCHANT_NOT_FOUND",
      });
    }
    return this.toResponseDto(row);
  }

  /**
   * Patch the merchant row. Only the fields the client submits are
   * mutated. If any JWS-signed field changes (displayName) OR the
   * payout channel/account mutates, we re-issue the JWS with a fresh
   * `iat` — keeps the printed sticker valid even after operational
   * rotation.
   */
  async patchMe(
    userId: string,
    dto: PatchMerchantDto,
  ): Promise<MerchantResponseDto> {
    const existing = await this.prisma.merchant.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: "No merchant profile for this user.",
        code: "MERCHANT_NOT_FOUND",
      });
    }

    const nextChannel = dto.payoutChannel ?? existing.payoutChannelCode;
    const nextAccount = dto.payoutAccountNumber ?? null;

    if (dto.payoutChannel || dto.payoutAccountNumber) {
      const channel = await this.findActiveChannel(
        nextChannel,
        existing.country,
      );
      if (dto.payoutAccountNumber) {
        this.validateAccountFormat(
          dto.payoutAccountNumber,
          channel.accountFormat,
        );
      }
    }

    const jwsFieldChanged = Boolean(
      dto.displayName && dto.displayName !== existing.displayName,
    );
    const payoutFieldChanged = Boolean(
      dto.payoutChannel || dto.payoutAccountNumber,
    );

    let newJwsWire = existing.jwsQr;
    let newJwsIat = existing.jwsIssuedAt;
    if (jwsFieldChanged || payoutFieldChanged) {
      const signed = await this.qrSigning.signMerchantQr({
        merchantId: existing.id,
        displayName: dto.displayName ?? existing.displayName,
        country: existing.country,
        qrisPan: existing.qrisPan ?? undefined,
      });
      newJwsWire = signed.wire;
      newJwsIat = new Date(signed.iat * 1000);
    }

    const updated = await this.prisma.merchant.update({
      where: { userId },
      data: {
        displayName: dto.displayName ?? existing.displayName,
        contactPhone: dto.contactPhone ?? existing.contactPhone,
        payoutChannelCode: nextChannel,
        payoutAccountNumber: nextAccount
          ? Buffer.from(nextAccount, "utf8")
          : existing.payoutAccountNumber,
        payoutAccountHolderName:
          dto.payoutAccountHolderName ?? existing.payoutAccountHolderName,
        jwsQr: newJwsWire,
        jwsIssuedAt: newJwsIat,
        jwsExpiresAt: null,
      },
    });

    return this.toResponseDto(updated);
  }

  /**
   * Manual JWS rotation — used by the merchant "rotate-qr" button
   * (§4.4 operational rotation) and by the ops runbook after a key
   * rollover. Always re-signs, even if no fields changed.
   */
  async rotateQr(userId: string): Promise<MerchantWithQrResponseDto> {
    const existing = await this.prisma.merchant.findUnique({
      where: { userId },
    });
    if (!existing) {
      throw new NotFoundException({
        message: "No merchant profile for this user.",
        code: "MERCHANT_NOT_FOUND",
      });
    }

    const signed = await this.qrSigning.signMerchantQr({
      merchantId: existing.id,
      displayName: existing.displayName,
      country: existing.country,
      qrisPan: existing.qrisPan ?? undefined,
    });

    const updated = await this.prisma.merchant.update({
      where: { userId },
      data: {
        jwsQr: signed.wire,
        jwsIssuedAt: new Date(signed.iat * 1000),
        jwsExpiresAt: null,
      },
    });

    return {
      merchant: this.toResponseDto(updated),
      jwsQr: updated.jwsQr,
    };
  }

  /**
   * List active payout channels for a country (spec §6.0 `ChannelDescriptor`
   * shape, §6.1 channels lookup). Public + read-only — mobile's
   * `merchant/signup-form.tsx` channel picker renders directly from this
   * response, so the DB `priority` column is the source of truth for
   * picker order (filter-at-source, memory `feedback_filter_at_source.md`).
   *
   * Cache: Valkey key `channels:<country>`, 1 h TTL. Only `isActive`
   * rows are cached, so flipping `isActive = false` propagates on the
   * next cache-miss (≤ 1 h; a follow-up task will add explicit
   * invalidation on the Channel mutation path). Cache misses and
   * Valkey outages fall through to the DB — the service degrades
   * cleanly rather than failing closed.
   *
   * Chain-extension: the `country` param is passed straight to the
   * `where` clause. No `if (country === "ID")` branching. Future
   * countries add rows, not code.
   */
  async listChannels(country: string): Promise<ChannelResponseDto[]> {
    const normalized = country.toUpperCase();
    const cacheKey = `${CHANNELS_CACHE_KEY_PREFIX}${normalized}`;

    // L1 cache read — non-fatal on failure, we just fall through to DB.
    if (this.valkey) {
      try {
        const cached = await this.valkey.get<ChannelResponseDto[]>(cacheKey);
        if (Array.isArray(cached)) {
          return cached;
        }
      } catch (err) {
        this.logger.warn(
          `Failed to read channels cache for ${normalized}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    // DB read. Composite sort: `priority ASC` is the display order ops
    // tunes; `channelCode ASC` is a stable tiebreaker so two channels
    // with identical priority always render in the same slot.
    //
    // Fees / limits are per-provider — live on `ProviderChannel`. The
    // pre-signup picker has no merchant row yet, so we default to the
    // same provider as `Merchant.payoutProvider @default("xendit")`.
    // Per-merchant fee personalization (when a merchant is known) is a
    // follow-up task.
    const rows = await this.prisma.channel.findMany({
      where: { country: normalized, isActive: true },
      orderBy: [{ priority: "asc" }, { channelCode: "asc" }],
      include: {
        providerChannels: {
          where: { provider: "xendit", isActive: true },
          take: 1,
        },
      },
    });

    const dtos: ChannelResponseDto[] = rows.map((row) => {
      const pc = row.providerChannels[0] ?? null;
      return {
        channelCode: row.channelCode,
        label: row.label,
        kind: row.kind as "ewallet" | "bank",
        accountFormat: row.accountFormat,
        priority: row.priority,
        minAmountIdr: pc?.minAmountIdr ?? null,
        maxAmountIdr: pc?.maxAmountIdr ?? null,
        feeIdr: pc?.feeIdr ?? 0,
        iconUrl: row.iconUrl ?? null,
      };
    });

    // Fire-and-forget cache write. Empty-array responses are still
    // cached — unknown-but-well-formed countries (e.g. `PH` pre-launch)
    // shouldn't thrash the DB on every request.
    if (this.valkey) {
      void this.valkey
        .set(cacheKey, dtos, { ttl: CHANNELS_CACHE_TTL_SECONDS })
        .catch((err) => {
          this.logger.warn(
            `Failed to write channels cache for ${normalized}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        });
    }

    return dtos;
  }

  /**
   * Look up an active channel row (filter-at-source). Returns 400 with
   * a helpful pointer if the code is unknown for the country — the
   * mobile copy tells the merchant to refresh the channel list.
   */
  private async findActiveChannel(channelCode: string, country: string) {
    const row = await this.prisma.channel.findFirst({
      where: { channelCode, country, isActive: true },
    });
    if (!row) {
      throw new BadRequestException({
        message: `Unknown payout channel '${channelCode}' for country '${country}'. See GET /v1/merchants/channels.`,
        code: "CHANNEL_UNKNOWN",
      });
    }
    return row;
  }

  /**
   * Validate the account number against the channel's `accountFormat`
   * regex (stored as a string — anchors are expected inside the regex).
   */
  private validateAccountFormat(account: string, format: string): void {
    let re: RegExp;
    try {
      re = new RegExp(format);
    } catch {
      this.logger.warn(
        `Channel accountFormat is not a valid regex: '${format}'`,
      );
      return; // Don't block the merchant for a malformed seed row.
    }
    if (!re.test(account)) {
      throw new BadRequestException({
        message:
          "Payout account number doesn't match the expected format for this channel.",
        code: "PAYOUT_ACCOUNT_FORMAT_INVALID",
      });
    }
  }

  /**
   * Project a DB row onto the wire shape. Sensitive fields stay out:
   * the decrypted account number never leaves, only a masked last-4.
   */
  private toResponseDto(row: {
    id: string;
    displayName: string;
    contactPhone: string;
    country: string;
    payoutChannelCode: string;
    payoutAccountNumber: Uint8Array | Buffer;
    payoutAccountHolderName: string;
    qrisPan: string | null;
    isActive: boolean;
    jwsQr: string;
    jwsIssuedAt: Date;
    jwsExpiresAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): MerchantResponseDto {
    const accountUtf8 = Buffer.from(row.payoutAccountNumber).toString("utf8");
    const last4 = accountUtf8.slice(-4).padStart(4, "•");
    return {
      id: row.id,
      displayName: row.displayName,
      country: row.country,
      payoutChannel: row.payoutChannelCode,
      payoutAccountLast4: last4,
      payoutAccountHolderName: row.payoutAccountHolderName,
      contactPhone: row.contactPhone || undefined,
      qrisPan: row.qrisPan ?? undefined,
      isActive: row.isActive,
      jwsQr: row.jwsQr,
      jwsIssuedAt: row.jwsIssuedAt.getTime(),
      jwsExpiresAt: row.jwsExpiresAt?.getTime() ?? null,
      createdAt: row.createdAt.getTime(),
      updatedAt: row.updatedAt.getTime(),
    };
  }
}

/**
 * Minimal ULID generator — Prisma's default is `@default(ulid())` which
 * fires DB-side, but we need the id locally to put inside the signed
 * JWS before the INSERT. 26-char Crockford base32 with a 48-bit time
 * prefix, matching Prisma 7's `ulid()` format.
 */
function generateUlid(): string {
  const ENC = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const time = Date.now();
  let timeEnc = "";
  let t = time;
  for (let i = 0; i < 10; i++) {
    timeEnc = ENC[t % 32] + timeEnc;
    t = Math.floor(t / 32);
  }
  let rand = "";
  // 16 chars × 5 bits = 80 bits of entropy. `crypto.randomBytes` would be
  // preferred but this tight helper keeps the service file self-contained;
  // collisions are vanishingly unlikely for the merchant-signup rate.
  for (let i = 0; i < 16; i++) {
    rand += ENC[Math.floor(Math.random() * 32)];
  }
  return timeEnc + rand;
}

/**
 * Detect Prisma's P2002 (unique constraint) error without importing the
 * error type from the generated client (keeps the service file loosely
 * coupled to Prisma's error-class export shape).
 */
function isUniqueConstraintError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; name?: string };
  return e.code === "P2002" || e.name === "PrismaClientKnownRequestError";
}
