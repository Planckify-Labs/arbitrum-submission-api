/**
 * ABI for the TakumiPay Point Deposit smart contract.
 * The contract stores stablecoin deposits keyed by a client-generated refId.
 * The API reads this contract to verify deposits before crediting points.
 *
 * NOTE: This is a placeholder ABI matching the expected contract interface.
 * Update when the final smart contract is deployed.
 */
export const PointDepositAbi = [
  {
    inputs: [{ internalType: "string", name: "refId", type: "string" }],
    name: "getTransactionByRef",
    outputs: [
      {
        components: [
          { internalType: "address", name: "walletAddress", type: "address" },
          { internalType: "address", name: "tokenAddress", type: "address" },
          { internalType: "uint256", name: "amount", type: "uint256" },
          { internalType: "string", name: "refId", type: "string" },
        ],
        internalType: "struct PointDepositContract.Transaction",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
] as const;
