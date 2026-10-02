# TakumiPay backend API (Arbitrum submission)

> Part of the TakumiPay submission to the Arbitrum Open House Singapore Online Buildathon. Start at the hub: **[https://github.com/Planckify-Labs/arbitrum-submission](https://github.com/Planckify-Labs/arbitrum-submission)** (fact sheet, deployments with transaction hashes, known limitations, reproduction commands).

**Role of this repository:** NestJS backend: chain and token catalog, EIP-712 quote signing, payment intents, fulfilment, FX rates.

**Chains:** Arbitrum One (42161), Arbitrum Sepolia (421614), Robinhood Chain testnet (46630). **Stablecoin:** Paxos USDG. **License:** GPL-3.0.

## Where to look
- Quote signing: `src/pay/quote-signer.service.ts`, boot guard `src/pay/quote-signer-boot.guard.ts`
- Payment intents: `src/pay/intents.service.ts`, on-chain settlement `src/pay/onchain-settlement.processor.ts`
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

