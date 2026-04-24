# Task 11 — `SettlementOrchestratorService` with `resolveProvider` factory

**Status:** Not taken
**Owner:** API (takumipay-api)
**Spec reference:** `onchain-merchant-settlement-spec.md` §4.2

## Why this matters

The orchestrator is the single place that branches on settlement rail.
It mirrors `PayoutService.resolveProvider` — same shape, same rule that
no caller ever branches on `path`. The orchestrator also owns the
`kickPayout` call after settlement, ensuring payout fires regardless
of rail.

## Scope

Create `src/pay/settlement/settlement-orchestrator.service.ts`:

```ts
@Injectable()
export class SettlementOrchestratorService {
  constructor(
    @Inject(PAYMENT_SETTLEMENT_NANOPAY)
    private readonly nanopay: IPaymentSettlementProvider,
    @Inject(PAYMENT_SETTLEMENT_ONCHAIN)
    private readonly onchain: IPaymentSettlementProvider,
    private readonly configService: ConfigService,
  ) {}

  resolveProvider(key: string): IPaymentSettlementProvider { ... }

  async settleAndKickPayout(intent, merchant, payerInput): Promise<SettleReceipt> {
    const provider = this.resolveProvider(this.resolveKey(intent));
    const receipt = await provider.settle({ intent, merchant, payerInput });
    if (receipt.status === "SETTLED") {
      this.kickPayout(intent.id);
    }
    return receipt;
  }
}
```

**Resolution precedence** (§4.2):

1. `PaymentIntent.path` if it maps to a concrete rail key.
2. `PAYMENT_SETTLEMENT_RAIL` env (default `"nanopay"`).
3. Future: `Merchant.preferredSettlementRail` (not in v1).

**`kickPayout`** — calls `PayoutService.trigger` fire-and-forget,
same as `IntentsService.kickPayout` does today (`intents.service.ts:1740-1760`).

## Rules (non-negotiable)

- **Single `resolveProvider` switch** — the only place in the codebase
  that branches on settlement rail. Mirror `PayoutService.resolveProvider`
  (`payout.service.ts:169-178`).
- **Unknown key throws** with a descriptive error (same as payout).
- **`kickPayout` is called from ONE place** — inside
  `settleAndKickPayout`, after `receipt.status === "SETTLED"`. Not inside
  individual adapters.

## Acceptance

- [ ] `SettlementOrchestratorService` exports `resolveProvider` and
      `settleAndKickPayout`.
- [ ] `resolveProvider("nanopay")` returns the nanopay adapter.
- [ ] `resolveProvider("onchain")` returns the onchain adapter.
- [ ] Unknown key throws.
- [ ] `kickPayout` fires only on `SETTLED` status.
- [ ] `pnpm run build` passes.

## Out of scope

- Onchain adapter injection (task 18 creates the adapter; task 12 wires
  DI but can use a stub until task 18 lands).
- Per-merchant preference column (§4.2 item 3 — deferred).
