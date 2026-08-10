import {
  Inject,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PrismaService } from "../prisma/prisma.service";
import { QuoteSignerService } from "./quote-signer.service";

/**
 * Boot-time assertion that the quote signer's derived address matches
 * the `quoteSignerAddress` stored on each active EVM `Blockchain` row.
 *
 * Fails fast on startup if there's a mismatch -- prevents the server
 * from silently signing quotes that the on-chain contract would reject
 * (wrong signer = invalid signature = wasted gas + failed settlement).
 *
 * Skipped in `NODE_ENV=test` to avoid requiring a real private key in
 * unit test harnesses.
 */
@Injectable()
export class QuoteSignerBootGuard implements OnModuleInit {
  private readonly logger = new Logger(QuoteSignerBootGuard.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    // `@Inject` is required, not decorative: the `| null` union makes
    // `design:paramtypes` emit `Object`, so without an explicit token Nest
    // cannot resolve this and `@Optional()` silently hands over `undefined`.
    // The guard then fell through to its "no signer configured" branch even
    // when a signer existed — it logged that the key was unset while
    // QuoteSignerService was initialising with that very key, and the
    // address check below never ran.
    @Optional()
    @Inject(QuoteSignerService)
    private readonly quoteSigner: QuoteSignerService | null = null,
  ) {}

  async onModuleInit(): Promise<void> {
    const nodeEnv = this.configService.get<string>("NODE_ENV");
    if (nodeEnv === "test") return;

    // No signer configured — there is nothing to compare, and the app is
    // still valid (EVM intents just come back unsigned). The mismatch check
    // below is the point of this guard; skipping it is not a silent pass.
    if (!this.quoteSigner) {
      this.logger.warn(
        "EVM_QUOTE_SIGNER_PRIVATE_KEY not set — EVM merchant quotes will be unsigned and onchain settlement will be unavailable.",
      );
      return;
    }

    const chains = await this.prisma.blockchain.findMany({
      where: { isActive: true, type: "EVM", quoteSignerAddress: { not: null } },
    });

    const signerAddress = this.quoteSigner.signerAddress.toLowerCase();

    for (const chain of chains) {
      if (chain.quoteSignerAddress!.toLowerCase() !== signerAddress) {
        const msg = `QuoteSigner address mismatch on chain ${chain.name} (chainId=${chain.chainId}): ` +
          `derived=${signerAddress}, DB=${chain.quoteSignerAddress}`;
        this.logger.error(msg);
        throw new Error(msg);
      }
      this.logger.log(
        `QuoteSigner verified for chain ${chain.name} (chainId=${chain.chainId})`,
      );
    }
  }
}
