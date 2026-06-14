import type { Merchant, ProviderChannel } from "@generated/prisma";
import type { PrismaService } from "../prisma/prisma.service";

/**
 * Resolve the per-provider channel row for a merchant + canonical channel
 * code. Centralises the `(channelCode, country, provider)` lookup so no
 * caller touches the `ProviderChannel` unique key directly — if the index
 * key ever changes, there's one place to fix.
 *
 * Returns `null` when no mapping exists. Callers decide whether that's a
 * 400 (bad config) or a fallback-to-default — the helper stays policy-free.
 */
export function getProviderChannel(
  prisma: Pick<PrismaService, "providerChannel">,
  merchant: Pick<Merchant, "country" | "payoutProvider">,
  channelCode: string,
): Promise<ProviderChannel | null> {
  return prisma.providerChannel.findUnique({
    where: {
      channelCode_country_provider: {
        channelCode,
        country: merchant.country,
        provider: merchant.payoutProvider,
      },
    },
  });
}

/**
 * Variant for code paths that have no merchant row yet (e.g. the pre-signup
 * channel-listing endpoint). Defaults `provider` to `"xendit"` — the same
 * default Merchant.payoutProvider carries — so the wire response stays
 * identical to pre-refactor behaviour.
 */
export function getProviderChannelForProvider(
  prisma: Pick<PrismaService, "providerChannel">,
  channelCode: string,
  country: string,
  provider: string,
): Promise<ProviderChannel | null> {
  return prisma.providerChannel.findUnique({
    where: {
      channelCode_country_provider: { channelCode, country, provider },
    },
  });
}
