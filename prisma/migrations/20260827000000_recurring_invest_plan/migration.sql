-- Recurring investment plans — DCA v1
-- (mobile-app docs/defi-quick-invest-spec.md §12).
--
-- The server nudges on a cadence, the user taps once, and the user's own key
-- signs. Nothing here is a credential: the row holds an intention and a due
-- date. `executionMode` defaults to 'reminder' and exists so §13's unattended
-- variant, if it is ever security-reviewed and built, coexists with v1 rows
-- instead of forcing a migration or a parallel table.
--
-- `walletAddress` is stored VERBATIM in its canonical per-encoding form and is
-- never lowercased: Solana (base58) and Stellar (base32 StrKey) are
-- case-significant. It is written only from the JWT, so no request can supply
-- a wrongly-cased value.
--
-- `caip2Id` rather than (namespace, chainId): a numeric chain id is EVM-shaped
-- and degenerates to 0 for Solana/Sui/Stellar. The namespace is the prefix, so
-- it is derived on read and cannot drift from a second stored column.
CREATE TABLE "RecurringInvestPlan" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "caip2Id" TEXT NOT NULL,
    "assetSymbol" TEXT NOT NULL,
    "amountUsd" DOUBLE PRECISION NOT NULL,
    "tier" TEXT NOT NULL,
    "cadenceDays" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "executionMode" TEXT NOT NULL DEFAULT 'reminder',
    "nextDueAt" TIMESTAMP(3) NOT NULL,
    "lastNudgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvestPlan_pkey" PRIMARY KEY ("id")
);

-- The watcher's only scan predicate.
CREATE INDEX "RecurringInvestPlan_status_nextDueAt_idx" ON "RecurringInvestPlan"("status", "nextDueAt");

-- Owner lookups, and the uniqueness check that stops a user stacking two
-- identical plans on the same chain.
CREATE INDEX "RecurringInvestPlan_walletAddress_caip2Id_idx" ON "RecurringInvestPlan"("walletAddress", "caip2Id");
