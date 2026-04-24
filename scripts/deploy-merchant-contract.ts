/**
 * deploy-merchant-contract.ts
 *
 * Stub script — deploys the TakumiWalletMerchant contract to Arc testnet
 * and configures the initial `backendSigner`.
 *
 * Prerequisites:
 *   - Arc testnet RPC URL in DEPLOYER_RPC_URL env var
 *   - Deployer private key in DEPLOYER_PRIVATE_KEY env var
 *   - Backend signer address in BACKEND_SIGNER_ADDRESS env var
 *
 * Usage:
 *   npx tsx scripts/deploy-merchant-contract.ts
 */

import {
  createWalletClient,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

async function main() {
  const rpcUrl = process.env.DEPLOYER_RPC_URL;
  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY as Hex | undefined;
  const backendSignerAddress = process.env.BACKEND_SIGNER_ADDRESS as
    | Address
    | undefined;

  if (!rpcUrl || !deployerKey || !backendSignerAddress) {
    console.error(
      'Missing required env vars: DEPLOYER_RPC_URL, DEPLOYER_PRIVATE_KEY, BACKEND_SIGNER_ADDRESS',
    );
    process.exit(1);
  }

  const account = privateKeyToAccount(deployerKey);

  const _walletClient = createWalletClient({
    account,
    transport: http(rpcUrl),
  });

  // TODO: Replace with compiled bytecode once the Solidity contract is finalised.
  // const deployTxHash = await walletClient.deployContract({
  //   abi: TakumiWalletMerchantAbi,
  //   bytecode: '0x…',
  //   args: [backendSignerAddress],
  // });
  //
  // console.log('Deploy tx hash:', deployTxHash);
  // const receipt = await publicClient.waitForTransactionReceipt({ hash: deployTxHash });
  // console.log('Contract deployed at:', receipt.contractAddress);
  //
  // After deployment, verify on-chain:
  //   - backendSigner() returns `backendSignerAddress`
  //   - QUOTE_TYPEHASH() returns the expected bytes32

  console.log('Deployer address:', account.address);
  console.log('Backend signer:  ', backendSignerAddress);
  console.log(
    'Deploy stub complete — replace the TODO above with compiled bytecode.',
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
