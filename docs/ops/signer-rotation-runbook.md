# Quote Signer Rotation Runbook

## When to rotate

- **Scheduled:** quarterly key rotation (per security policy)
- **Emergency:** suspected key compromise (P0 — execute immediately)

## Steps

### 1. Generate new key

```bash
# Option A: OpenSSL
openssl ecparam -name secp256k1 -genkey -noout | openssl ec -text -noout

# Option B: viem/ethers (recommended for address derivation)
node -e "
  const { generatePrivateKey, privateKeyToAddress } = require('viem/accounts');
  const key = generatePrivateKey();
  console.log('Private key:', key);
  console.log('Address:', privateKeyToAddress(key));
"

# Option C: cast (Foundry)
cast wallet new
```

Record the new private key and derived address securely. For production,
use a KMS/HSM to generate and store the key.

### 2. Update contract

The contract supports a grace window via `previousSigner` (if implemented
per spec ss11 recommendation). During the grace window, both the old and
new signers are accepted.

```bash
# Multi-sig or owner executes rotateBackendSigner(newAddress)
cast send <CONTRACT_ADDRESS> \
  "rotateBackendSigner(address)" \
  <NEW_SIGNER_ADDRESS> \
  --private-key <OWNER_KEY> \
  --rpc-url <RPC_URL>
```

For each active EVM chain:
```bash
# Repeat for every chain where TakumiWallet is deployed
cast send <CONTRACT_ADDRESS_CHAIN_1> "rotateBackendSigner(address)" <NEW_ADDRESS> ...
cast send <CONTRACT_ADDRESS_CHAIN_2> "rotateBackendSigner(address)" <NEW_ADDRESS> ...
```

### 3. Update database

```sql
UPDATE "Blockchain"
SET "quoteSignerAddress" = '<new-address>'
WHERE "isActive" = true AND "isEVM" = true;
```

Verify:
```sql
SELECT "name", "chainId", "quoteSignerAddress"
FROM "Blockchain"
WHERE "isActive" = true AND "isEVM" = true;
```

### 4. Update environment

```bash
# Update QUOTE_SIGNER_PRIVATE_KEY in env/secrets manager
# Then deploy/bounce the service
```

The service performs a boot-time assertion:
`derivedAddress(QUOTE_SIGNER_PRIVATE_KEY) === Blockchain.quoteSignerAddress`

If the assertion fails, the service will not start — this is intentional.
Ensure step 3 (DB update) is complete before step 4 (service bounce).

### 5. Grace window

- Old signer quotes remain valid for up to 15 minutes (max quote TTL for `direct_arc`)
- Contract accepts both signers during the `previousSigner` grace window (30 min)
- After 30 min, call `clearPreviousSigner()` to disable old key permanently:

```bash
cast send <CONTRACT_ADDRESS> \
  "clearPreviousSigner()" \
  --private-key <OWNER_KEY> \
  --rpc-url <RPC_URL>
```

### 6. Audit

Post-rotation checks (within 1 hour):

```sql
-- Check for any signed-but-unredeemed quotes from the old key
SELECT pi."id", pi."status", pi."expiresAt", pi."createdAt"
FROM "PaymentIntent" pi
WHERE pi."path" = 'direct_arc'
  AND pi."status" = 'QUOTED'
  AND pi."createdAt" < NOW() - INTERVAL '5 minutes'
  AND pi."expiresAt" > NOW();
```

Monitor BAD_QUOTE revert rate:
```sql
SELECT COUNT(*)
FROM "OnchainSettlement"
WHERE "failureCode" IN ('BAD_QUOTE', 'UNKNOWN')
  AND "createdAt" > NOW() - INTERVAL '1 hour';
```

Expected: zero BAD_QUOTE failures post-rotation (grace window covers in-flight quotes).
If BAD_QUOTE count > 0 within the grace window, investigate:
- Was the old signer cleared prematurely?
- Is the new signer address correct on all chains?

## Emergency rotation (suspected compromise)

Time-critical steps — execute in order:

1. **Immediately:** Rotate signer on contract (step 2 above) — this blocks new forged quotes
2. **Immediately:** Update DB (step 3) + bounce service (step 4)
3. **Within 15 min:** Clear `previousSigner` on contract (do NOT wait 30 min)
4. **Within 1 hour:** Audit all quotes signed in the suspected compromise window
5. **Within 24 hours:** File incident report; review logs for unauthorized quote creation

Clearing `previousSigner` early means any quotes signed by the old key
that haven't been redeemed will revert with `BAD_QUOTE`. Customers will
need to re-quote. This is acceptable in an emergency — no funds are lost,
only gas on reverted transactions.

## Verification checklist

- [ ] New key generated and stored securely
- [ ] `rotateBackendSigner` called on all active chain contracts
- [ ] `Blockchain.quoteSignerAddress` updated for all active EVM chains
- [ ] `QUOTE_SIGNER_PRIVATE_KEY` updated in secrets manager
- [ ] Service bounced and started successfully (boot assertion passed)
- [ ] BAD_QUOTE rate at 0 for 1 hour post-rotation
- [ ] `clearPreviousSigner` called after grace window (30 min or immediately for emergency)
- [ ] No orphaned QUOTED intents from old signer key
