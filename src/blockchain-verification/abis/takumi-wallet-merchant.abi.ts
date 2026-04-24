export const TakumiWalletMerchantAbi = [
	{
		"inputs": [],
		"name": "QUOTE_EXPIRED",
		"type": "error"
	},
	{
		"inputs": [],
		"name": "REF_CONSUMED",
		"type": "error"
	},
	{
		"inputs": [],
		"name": "BAD_QUOTE",
		"type": "error"
	},
	{
		"inputs": [],
		"name": "FEE_EXCEEDS_AMOUNT",
		"type": "error"
	},
	{
		"inputs": [],
		"name": "NATIVE_AMOUNT_MISMATCH",
		"type": "error"
	},
	{
		"inputs": [],
		"name": "UNEXPECTED_NATIVE",
		"type": "error"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "string",
				"name": "refId",
				"type": "string"
			},
			{
				"indexed": true,
				"internalType": "address",
				"name": "payer",
				"type": "address"
			},
			{
				"indexed": true,
				"internalType": "string",
				"name": "merchantId",
				"type": "string"
			},
			{
				"indexed": false,
				"internalType": "address",
				"name": "tokenAddress",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "platformFeeAmount",
				"type": "uint256"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "timestamp",
				"type": "uint256"
			}
		],
		"name": "MerchantPaymentProcessed",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "token",
				"type": "address"
			},
			{
				"indexed": true,
				"internalType": "address",
				"name": "recipient",
				"type": "address"
			},
			{
				"indexed": false,
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "PlatformFeesSwept",
		"type": "event"
	},
	{
		"anonymous": false,
		"inputs": [
			{
				"indexed": true,
				"internalType": "address",
				"name": "previousSigner",
				"type": "address"
			},
			{
				"indexed": true,
				"internalType": "address",
				"name": "newSigner",
				"type": "address"
			}
		],
		"name": "BackendSignerRotated",
		"type": "event"
	},
	{
		"inputs": [
			{
				"components": [
					{
						"internalType": "string",
						"name": "refId",
						"type": "string"
					},
					{
						"internalType": "string",
						"name": "merchantId",
						"type": "string"
					},
					{
						"internalType": "address",
						"name": "tokenAddress",
						"type": "address"
					},
					{
						"internalType": "uint256",
						"name": "amount",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "platformFeeAmount",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "fiatAmountMinor",
						"type": "uint256"
					},
					{
						"internalType": "bytes3",
						"name": "fiatCurrency",
						"type": "bytes3"
					},
					{
						"internalType": "uint256",
						"name": "exchangeRateId",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "expiresAt",
						"type": "uint256"
					}
				],
				"internalType": "struct TakumiWalletMerchant.QuoteCommitment",
				"name": "quote",
				"type": "tuple"
			},
			{
				"internalType": "bytes",
				"name": "backendSignature",
				"type": "bytes"
			}
		],
		"name": "processMerchantPayment",
		"outputs": [],
		"stateMutability": "payable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "string",
				"name": "refId",
				"type": "string"
			}
		],
		"name": "getMerchantPaymentByRef",
		"outputs": [
			{
				"components": [
					{
						"internalType": "address",
						"name": "payer",
						"type": "address"
					},
					{
						"internalType": "address",
						"name": "tokenAddress",
						"type": "address"
					},
					{
						"internalType": "string",
						"name": "merchantId",
						"type": "string"
					},
					{
						"internalType": "string",
						"name": "refId",
						"type": "string"
					},
					{
						"internalType": "uint256",
						"name": "amount",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "platformFeeAmount",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "fiatAmountMinor",
						"type": "uint256"
					},
					{
						"internalType": "bytes3",
						"name": "fiatCurrency",
						"type": "bytes3"
					},
					{
						"internalType": "uint256",
						"name": "exchangeRateId",
						"type": "uint256"
					},
					{
						"internalType": "uint256",
						"name": "timestamp",
						"type": "uint256"
					}
				],
				"internalType": "struct TakumiWalletMerchant.MerchantPayment",
				"name": "",
				"type": "tuple"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "token",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "recipient",
				"type": "address"
			},
			{
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "sweepPlatformFees",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "token",
				"type": "address"
			},
			{
				"internalType": "address",
				"name": "recipient",
				"type": "address"
			},
			{
				"internalType": "uint256",
				"name": "amount",
				"type": "uint256"
			}
		],
		"name": "sweepMerchantBacking",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "next",
				"type": "address"
			}
		],
		"name": "rotateBackendSigner",
		"outputs": [],
		"stateMutability": "nonpayable",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "backendSigner",
		"outputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [
			{
				"internalType": "address",
				"name": "",
				"type": "address"
			}
		],
		"name": "platformFeeAccrued",
		"outputs": [
			{
				"internalType": "uint256",
				"name": "",
				"type": "uint256"
			}
		],
		"stateMutability": "view",
		"type": "function"
	},
	{
		"inputs": [],
		"name": "QUOTE_TYPEHASH",
		"outputs": [
			{
				"internalType": "bytes32",
				"name": "",
				"type": "bytes32"
			}
		],
		"stateMutability": "view",
		"type": "function"
	}
] as const;
