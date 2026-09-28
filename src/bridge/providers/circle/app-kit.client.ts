/**
 * Circle Arc App Kit — quoting side.
 *
 * Spec: docs/bridge-capability-spec.md §5.4.
 *
 * THE ONLY FILE IN THIS REPO THAT IMPORTS `@circle-fin/app-kit`. The two
 * Circle adapters (`circle-cctp`, `circle-cctpx`) talk to this wrapper, and
 * nothing above them knows App Kit exists, so replacing it with raw
 * contract calls (or a different SDK) stays a change to this file.
 *
 * What runs here is READ-ONLY: `getSupportedChains("bridge")` and
 * `estimateBridge()`. App Kit's estimate needs an adapter for the source
 * wallet (it estimates the approve + burn cost against that address), so
 * it gets one that CANNOT sign: a Viem adapter around an account whose
 * every signing method throws (EVM sources), or App Kit's Solana adapter
 * around a wallet provider whose every signing method throws (Solana
 * sources, `@circle-fin/adapter-solana`, the adapter Circle's bridge
 * quickstart uses for Solana-source bridges). The backend never holds a key and never
 * submits anything. Execution happens on the device, with the user's own
 * signer, through the same App Kit `bridge()` (mobile
 * `services/bridgeRoutes/adapters/circle/`).
 *
 * Verified against docs.arc.io/app-kit (SDK reference, "Estimate costs",
 * "Use Forwarding Service", "Adapter setups") and the shipped package
 * source, `@circle-fin/app-kit@1.15.3`, 2026-09-26.
 */

import { createSolanaAdapterFromProvider } from "@circle-fin/adapter-solana";
import { ViemAdapter } from "@circle-fin/adapter-viem-v2";
import { AppKit } from "@circle-fin/app-kit";
import { Injectable, Logger } from "@nestjs/common";
import { http, type Chain, createPublicClient, createWalletClient } from "viem";
import { toAccount } from "viem/accounts";
import type { CircleChainDef } from "./circle-route";

/** One fee line exactly as App Kit reports it (human-readable amount). */
export interface CircleEstimateFee {
  type: string;
  token: string;
  amount: string | null;
}

export interface CircleEstimateGas {
  name: string;
  token: string;
  /** Human-readable native amount, e.g. `"0.00000315"`. */
  fee: string | null;
}

export interface CircleEstimate {
  fees: CircleEstimateFee[];
  gasFees: CircleEstimateGas[];
  /**
   * The provider's signed quote, when it issues one (CCTPx does). OPAQUE:
   * App Kit's reference says to pass it straight back to `bridge()` so
   * "the fee you were quoted is the fee you pay", and never to log or
   * decode it. It rides to the device inside the execution payload.
   */
  quote?: unknown;
  /** Quote expiry in epoch ms, when the provider states one. */
  quoteExpiresAtMs?: number;
}

export interface CircleEstimateRequest {
  source: CircleChainDef;
  destination: CircleChainDef;
  fromAddress: string;
  recipientAddress: string;
  /** Human decimal string, the only amount format App Kit accepts. */
  amount: string;
  /** `"USDC"` or a CCTPx symbol such as `"EURC"`. */
  token: string;
  /** Human decimal string. Omitted = App Kit derives it. */
  maxFee?: string;
}

/**
 * An account that can be ASKED for its address and nothing else. App Kit
 * resolves the source address through the adapter; handing it an account
 * that throws on every signature makes "the backend signs nothing" a
 * property of the code rather than a promise.
 */
function readOnlyAccount(address: `0x${string}`) {
  const refuse = async (): Promise<never> => {
    throw new Error("read-only account: the backend never signs");
  };
  return toAccount({
    address,
    signMessage: refuse,
    signTransaction: refuse,
    signTypedData: refuse,
  });
}

/**
 * The Solana analogue of {@link readOnlyAccount}: a wallet provider that
 * reports an address and refuses every signature.
 */
function readOnlySolanaProvider(address: string) {
  const refuse = async (): Promise<never> => {
    throw new Error("read-only provider: the backend never signs");
  };
  const publicKey = { toString: () => address };
  return {
    isConnected: true,
    publicKey,
    connect: async () => ({ publicKey }),
    disconnect: async () => {},
    signTransaction: refuse,
    signAllTransactions: refuse,
    signMessage: refuse,
  };
}

/**
 * One read-only source adapter builder per App Kit chain family. A lookup,
 * not a branch: a family with no builder simply cannot be quoted as a
 * source, which `circle-cctp.route()` already refuses.
 */
const READ_ONLY_SOURCE_ADAPTERS: Record<
  string,
  (req: CircleEstimateRequest, chains: CircleChainDef[]) => Promise<unknown>
> = {
  evm: async (req, chains) => {
    const account = readOnlyAccount(req.fromAddress as `0x${string}`);
    return new ViemAdapter(
      {
        getPublicClient: ({ chain }: { chain: Chain }) =>
          createPublicClient({
            chain,
            transport: http(undefined, { timeout: 10_000 }),
          }),
        getWalletClient: ({ chain }: { chain: Chain }) =>
          createWalletClient({
            account,
            chain,
            transport: http(undefined, { timeout: 10_000 }),
          }),
      },
      {
        addressContext: "user-controlled",
        // biome-ignore lint/suspicious/noExplicitAny: App Kit's chain-definition type is not re-exported by the adapter package
        supportedChains: chains.filter((c) => c.type === "evm") as any,
      },
    );
  },
  solana: (req) =>
    createSolanaAdapterFromProvider({
      provider: readOnlySolanaProvider(req.fromAddress),
      // biome-ignore lint/suspicious/noExplicitAny: capability generics do not unify across packages
      capabilities: { addressContext: "user-controlled" } as any,
    }),
};

@Injectable()
export class CircleAppKitClient {
  private readonly logger = new Logger(CircleAppKitClient.name);
  private kit: AppKit | null = null;
  private chains: CircleChainDef[] | null = null;

  private getKit(): AppKit {
    if (!this.kit) {
      // Telemetry off: an error report can carry wallet addresses, and
      // nothing in this quoting path needs Circle to receive either.
      this.kit = new AppKit({
        disableAnalytics: true,
        disableErrorReporting: true,
      });
    }
    return this.kit;
  }

  /**
   * App Kit's own bridge chain list — the queried support matrix (§5.3).
   * A chain Circle adds lights up here on an SDK bump, with no table of
   * ours to edit.
   */
  bridgeChains(): CircleChainDef[] {
    if (!this.chains) {
      this.chains = this.getKit().getSupportedChains(
        "bridge",
      ) as unknown as CircleChainDef[];
    }
    return this.chains;
  }

  async estimate(req: CircleEstimateRequest): Promise<CircleEstimate> {
    const kit = this.getKit();
    const build = READ_ONLY_SOURCE_ADAPTERS[req.source.type];
    if (!build) {
      throw new Error(`no read-only adapter for ${req.source.type} sources`);
    }
    const adapter = await build(req, this.bridgeChains());

    // biome-ignore lint/suspicious/noExplicitAny: params cross two SDK packages whose generics do not unify
    const params: any = {
      from: { adapter, chain: req.source.chain },
      // Forwarding Service, always: Circle submits the destination mint,
      // so the user needs no destination gas and no destination wallet
      // interaction (§7.5.1). App Kit only accepts a bare
      // `recipientAddress` destination together with `useForwarder: true`.
      to: {
        recipientAddress: req.recipientAddress,
        chain: req.destination.chain,
        useForwarder: true,
      },
      amount: req.amount,
      token: req.token,
      config: {
        // Standard transfer. Free at the protocol level; Fast is a fee the
        // user did not ask for (swap spec §4.10).
        transferSpeed: "SLOW",
        ...(req.maxFee !== undefined ? { maxFee: req.maxFee } : {}),
      },
    };

    const raw = (await kit.estimateBridge(params)) as unknown as {
      fees?: Array<{ type?: string; token?: string; amount?: string | null }>;
      gasFees?: Array<{
        name?: string;
        token?: string;
        fees?: { fee?: string } | null;
      }>;
      quote?: unknown;
    };

    const fees: CircleEstimateFee[] = (raw.fees ?? []).map((f) => ({
      type: String(f.type ?? "other"),
      token: String(f.token ?? ""),
      amount: f.amount ?? null,
    }));
    const gasFees: CircleEstimateGas[] = (raw.gasFees ?? []).map((g) => ({
      name: String(g.name ?? ""),
      token: String(g.token ?? ""),
      fee: g.fees?.fee ?? null,
    }));

    // Reading the stated expiry is not decoding the quote: it is the one
    // field the TTL on our own card must not outlive.
    const expiresAt = (raw.quote as { expiresAt?: unknown } | undefined)
      ?.expiresAt;
    const quoteExpiresAtMs =
      typeof expiresAt === "number" && Number.isFinite(expiresAt)
        ? expiresAt * 1000
        : undefined;

    if (fees.some((f) => f.amount === null)) {
      this.logger.debug(
        `[estimate] ${req.source.chain}->${req.destination.chain} fee line without an amount`,
      );
    }

    return {
      fees,
      gasFees,
      ...(raw.quote !== undefined ? { quote: raw.quote } : {}),
      ...(quoteExpiresAtMs !== undefined ? { quoteExpiresAtMs } : {}),
    };
  }
}
