# TakumiPay backend API (Arbitrum submission)

> Part of the TakumiPay submission to the Arbitrum Open House Singapore Online Buildathon. Start at the hub: **[https://github.com/Planckify-Labs/arbitrum-submission](https://github.com/Planckify-Labs/arbitrum-submission)** (fact sheet, deployments with transaction hashes, known limitations, reproduction commands).

**Role of this repository:** NestJS backend that turns a scanned QRIS code into a USDG payment: it resolves the merchant, prices the rupiah amount in USDG, signs an EIP-712 quote, watches settlement on-chain and triggers the IDR payout. Also holds the chain and token catalog and bill fulfilment.

**Chains:** Arbitrum One (42161), Arbitrum Sepolia (421614), Robinhood Chain testnet (46630). **Stablecoin:** Paxos USDG. **License:** GPL-3.0.

## Where to look
- Quote signing: `src/pay/quote-signer.service.ts`, boot guard `src/pay/quote-signer-boot.guard.ts`
- Payment intents: `src/pay/intents.service.ts`, on-chain settlement `src/pay/onchain-settlement.processor.ts`
- QRIS merchant lookup (registered-merchant pilot): `extractQrisPan()` and the merchant lookup in `src/pay/intents.service.ts`
- Test merchant (GTron, SELONG): `seedTestMerchants()` in `src/scripts/prisma/seed.ts`
- Points: `src/points/`
- Arbitrum and Robinhood chain rows, USDG token rows, `takumi_pay` contract addresses and the USDG to IDR FX row: `src/scripts/prisma/seed.ts`

## Run
```bash
cp .env.example .env   # fill in your own values; third-party provider keys are not included
pnpm install
pnpm start:dev
```

The `EVM_QUOTE_SIGNER_PRIVATE_KEY` used on the hackathon deployments is a shared, publicly known testnet key. See hub README section 5.

---

