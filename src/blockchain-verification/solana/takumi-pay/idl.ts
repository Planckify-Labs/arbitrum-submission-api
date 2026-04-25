export const TAKUMI_PAY_IDL = {
  "address": "6CCTEtYrk8unNhjYQ7npiLUf1iKQQJU88JSYn8EJLNYy",
  "metadata": {
    "name": "takumi_pay",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "TakumiPay Solana Program — merchant payments, transactions, point deposits"
  },
  "instructions": [
    {
      "name": "accept_ownership",
      "discriminator": [
        172,
        23,
        43,
        13,
        238,
        213,
        85,
        150
      ],
      "accounts": [
        {
          "name": "new_owner",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "add_admin",
      "discriminator": [
        177,
        236,
        33,
        205,
        124,
        152,
        55,
        186
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin_pubkey"
        },
        {
          "name": "admin_record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "admin_pubkey"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "add_allowed_point_token",
      "discriminator": [
        46,
        188,
        165,
        50,
        78,
        78,
        42,
        232
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "allowed_token",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "cancel_ownership_transfer",
      "discriminator": [
        2,
        184,
        195,
        105,
        138,
        142,
        154,
        75
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancel_withdrawal",
      "discriminator": [
        183,
        104,
        181,
        250,
        28,
        128,
        210,
        70
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "withdrawal_request"
          ]
        },
        {
          "name": "withdrawal_request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "withdrawal_request.nonce",
                "account": "WithdrawalRequest"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "create_transaction_sol",
      "discriminator": [
        15,
        148,
        64,
        222,
        85,
        10,
        108,
        111
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tx_record",
          "writable": true
        },
        {
          "name": "ref_record",
          "writable": true
        },
        {
          "name": "spending_limit",
          "optional": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "CreateTransactionParams"
            }
          }
        }
      ]
    },
    {
      "name": "create_transaction_token",
      "discriminator": [
        102,
        151,
        178,
        25,
        248,
        110,
        102,
        235
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "tx_record",
          "writable": true
        },
        {
          "name": "ref_record",
          "writable": true
        },
        {
          "name": "token_mint"
        },
        {
          "name": "payer_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "spending_limit",
          "optional": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "CreateTransactionParams"
            }
          }
        }
      ]
    },
    {
      "name": "deposit_points",
      "discriminator": [
        184,
        73,
        55,
        238,
        103,
        247,
        76,
        228
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "allowed_token"
          ]
        },
        {
          "name": "token_mint"
        },
        {
          "name": "allowed_token",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "point_deposit",
          "writable": true
        },
        {
          "name": "point_ref_record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  105,
                  110,
                  116,
                  95,
                  114,
                  101,
                  102
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "arg",
                "path": "ref_id_hash"
              }
            ]
          }
        },
        {
          "name": "payer_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "ref_id",
          "type": "string"
        },
        {
          "name": "ref_id_hash",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "execute_withdrawal_sol",
      "discriminator": [
        56,
        220,
        82,
        197,
        255,
        165,
        245,
        186
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "withdrawal_request"
          ]
        },
        {
          "name": "withdrawal_request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "withdrawal_request.nonce",
                "account": "WithdrawalRequest"
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "execute_withdrawal_token",
      "discriminator": [
        199,
        121,
        223,
        85,
        242,
        0,
        202,
        194
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "withdrawal_request"
          ]
        },
        {
          "name": "withdrawal_request",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  119,
                  105,
                  116,
                  104,
                  100,
                  114,
                  97,
                  119,
                  97,
                  108
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "withdrawal_request.nonce",
                "account": "WithdrawalRequest"
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": []
    },
    {
      "name": "initialize",
      "discriminator": [
        175,
        175,
        109,
        31,
        13,
        152,
        155,
        237
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "backend_signer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "process_merchant_payment_sol",
      "discriminator": [
        6,
        32,
        215,
        30,
        94,
        56,
        25,
        115
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "merchant_payment",
          "writable": true
        },
        {
          "name": "platform_fee_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  102,
                  101,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "instructions_sysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "MerchantQuoteParams"
            }
          }
        }
      ]
    },
    {
      "name": "process_merchant_payment_token",
      "discriminator": [
        15,
        243,
        125,
        245,
        253,
        85,
        95,
        176
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "merchant_payment",
          "writable": true
        },
        {
          "name": "platform_fee_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  102,
                  101,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "payer_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "payer"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "instructions_sysvar",
          "address": "Sysvar1nstructions1111111111111111111111111"
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "params",
          "type": {
            "defined": {
              "name": "MerchantQuoteParams"
            }
          }
        }
      ]
    },
    {
      "name": "queue_withdrawal",
      "discriminator": [
        153,
        8,
        176,
        235,
        189,
        140,
        146,
        223
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "withdrawal_request",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "token_mint",
          "type": "pubkey"
        },
        {
          "name": "recipient",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "is_native",
          "type": "bool"
        }
      ]
    },
    {
      "name": "remove_admin",
      "discriminator": [
        74,
        202,
        71,
        106,
        252,
        31,
        72,
        183
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "admin_record"
          ]
        },
        {
          "name": "admin_pubkey"
        },
        {
          "name": "admin_record",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  100,
                  109,
                  105,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "admin_pubkey"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "remove_allowed_point_token",
      "discriminator": [
        237,
        16,
        48,
        242,
        33,
        126,
        89,
        118
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "allowed_token"
          ]
        },
        {
          "name": "token_mint"
        },
        {
          "name": "allowed_token",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  97,
                  108,
                  108,
                  111,
                  119,
                  101,
                  100,
                  95,
                  112,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "rotate_backend_signer",
      "discriminator": [
        144,
        238,
        219,
        97,
        210,
        50,
        23,
        119
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "new_signer",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "set_paused",
      "discriminator": [
        91,
        60,
        125,
        192,
        176,
        225,
        166,
        218
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin_record",
          "docs": [
            "Optional admin record — required when caller is not the owner."
          ],
          "optional": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "set_point_deposits_paused",
      "discriminator": [
        79,
        86,
        19,
        104,
        153,
        181,
        219,
        165
      ],
      "accounts": [
        {
          "name": "authority",
          "signer": true
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "admin_record",
          "optional": true
        }
      ],
      "args": [
        {
          "name": "paused",
          "type": "bool"
        }
      ]
    },
    {
      "name": "set_spending_limit",
      "discriminator": [
        39,
        48,
        237,
        161,
        49,
        171,
        155,
        208
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "spending_limit",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  108,
                  105,
                  109,
                  105,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "max_amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "set_withdrawal_delay",
      "discriminator": [
        188,
        153,
        14,
        109,
        50,
        127,
        169,
        158
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "delay",
          "type": "i64"
        }
      ]
    },
    {
      "name": "sweep_merchant_backing_sol",
      "discriminator": [
        96,
        130,
        106,
        97,
        132,
        125,
        31,
        147
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweep_merchant_backing_token",
      "discriminator": [
        62,
        166,
        15,
        135,
        176,
        30,
        247,
        42
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweep_platform_fees_sol",
      "discriminator": [
        97,
        166,
        239,
        120,
        245,
        106,
        255,
        68
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "platform_fee_account"
          ]
        },
        {
          "name": "platform_fee_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  102,
                  101,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0,
                  0
                ]
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "sweep_platform_fees_token",
      "discriminator": [
        247,
        179,
        81,
        65,
        213,
        14,
        71,
        230
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          },
          "relations": [
            "platform_fee_account"
          ]
        },
        {
          "name": "token_mint"
        },
        {
          "name": "platform_fee_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  108,
                  97,
                  116,
                  102,
                  111,
                  114,
                  109,
                  95,
                  102,
                  101,
                  101
                ]
              },
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "transfer_ownership",
      "discriminator": [
        65,
        177,
        215,
        73,
        53,
        45,
        99,
        47
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "new_owner",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "withdraw_sol",
      "discriminator": [
        145,
        131,
        74,
        136,
        65,
        137,
        42,
        38
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "recipient",
          "writable": true
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw_token",
      "discriminator": [
        136,
        235,
        181,
        5,
        101,
        109,
        57,
        81
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "config"
          ]
        },
        {
          "name": "config",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  110,
                  102,
                  105,
                  103
                ]
              }
            ]
          }
        },
        {
          "name": "token_mint"
        },
        {
          "name": "vault_token_account",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "config"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "token_mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "recipient_token_account",
          "writable": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "Admin",
      "discriminator": [
        244,
        158,
        220,
        65,
        8,
        73,
        4,
        65
      ]
    },
    {
      "name": "AllowedPointToken",
      "discriminator": [
        135,
        129,
        14,
        21,
        72,
        249,
        88,
        234
      ]
    },
    {
      "name": "Config",
      "discriminator": [
        155,
        12,
        170,
        224,
        30,
        250,
        204,
        130
      ]
    },
    {
      "name": "MerchantPayment",
      "discriminator": [
        91,
        127,
        5,
        117,
        233,
        164,
        146,
        91
      ]
    },
    {
      "name": "PlatformFeeAccount",
      "discriminator": [
        3,
        58,
        42,
        131,
        224,
        90,
        94,
        216
      ]
    },
    {
      "name": "PointDepositRecord",
      "discriminator": [
        201,
        197,
        66,
        68,
        123,
        98,
        130,
        44
      ]
    },
    {
      "name": "RefRecord",
      "discriminator": [
        207,
        231,
        200,
        34,
        52,
        56,
        43,
        237
      ]
    },
    {
      "name": "SpendingLimit",
      "discriminator": [
        10,
        201,
        27,
        160,
        218,
        195,
        222,
        152
      ]
    },
    {
      "name": "TransactionRecord",
      "discriminator": [
        206,
        23,
        5,
        97,
        161,
        157,
        25,
        107
      ]
    },
    {
      "name": "WithdrawalRequest",
      "discriminator": [
        242,
        88,
        147,
        173,
        182,
        62,
        229,
        193
      ]
    }
  ],
  "events": [
    {
      "name": "AdminAdded",
      "discriminator": [
        23,
        13,
        37,
        90,
        130,
        53,
        75,
        251
      ]
    },
    {
      "name": "AdminRemoved",
      "discriminator": [
        59,
        133,
        36,
        27,
        156,
        79,
        75,
        146
      ]
    },
    {
      "name": "BackendSignerRotated",
      "discriminator": [
        26,
        237,
        252,
        25,
        217,
        82,
        140,
        116
      ]
    },
    {
      "name": "ContractPausedToggled",
      "discriminator": [
        253,
        21,
        57,
        17,
        120,
        73,
        183,
        234
      ]
    },
    {
      "name": "MaxTransactionAmountUpdated",
      "discriminator": [
        158,
        28,
        178,
        247,
        170,
        56,
        59,
        73
      ]
    },
    {
      "name": "MerchantBackingSwept",
      "discriminator": [
        182,
        240,
        31,
        34,
        17,
        106,
        29,
        133
      ]
    },
    {
      "name": "MerchantPaymentProcessed",
      "discriminator": [
        177,
        114,
        82,
        110,
        36,
        237,
        19,
        122
      ]
    },
    {
      "name": "OwnershipTransferCancelled",
      "discriminator": [
        120,
        203,
        162,
        145,
        180,
        57,
        253,
        23
      ]
    },
    {
      "name": "OwnershipTransferInitiated",
      "discriminator": [
        181,
        32,
        40,
        60,
        60,
        64,
        235,
        29
      ]
    },
    {
      "name": "OwnershipTransferred",
      "discriminator": [
        172,
        61,
        205,
        183,
        250,
        50,
        38,
        98
      ]
    },
    {
      "name": "PlatformFeesSwept",
      "discriminator": [
        11,
        134,
        55,
        195,
        74,
        64,
        122,
        35
      ]
    },
    {
      "name": "PointDepositCreated",
      "discriminator": [
        129,
        49,
        90,
        82,
        123,
        73,
        105,
        63
      ]
    },
    {
      "name": "PointDepositsPausedToggled",
      "discriminator": [
        235,
        30,
        145,
        78,
        56,
        1,
        240,
        250
      ]
    },
    {
      "name": "PointTokenAdded",
      "discriminator": [
        56,
        53,
        236,
        45,
        122,
        158,
        212,
        101
      ]
    },
    {
      "name": "PointTokenRemoved",
      "discriminator": [
        38,
        92,
        22,
        15,
        181,
        36,
        64,
        183
      ]
    },
    {
      "name": "TransactionCreated",
      "discriminator": [
        55,
        194,
        205,
        6,
        76,
        142,
        153,
        217
      ]
    },
    {
      "name": "WithdrawEvent",
      "discriminator": [
        22,
        9,
        133,
        26,
        160,
        44,
        71,
        192
      ]
    },
    {
      "name": "WithdrawalCancelled",
      "discriminator": [
        119,
        175,
        207,
        80,
        186,
        237,
        229,
        9
      ]
    },
    {
      "name": "WithdrawalDelayUpdated",
      "discriminator": [
        255,
        161,
        164,
        83,
        36,
        246,
        65,
        108
      ]
    },
    {
      "name": "WithdrawalExecuted",
      "discriminator": [
        37,
        78,
        199,
        192,
        51,
        68,
        173,
        162
      ]
    },
    {
      "name": "WithdrawalQueued",
      "discriminator": [
        116,
        223,
        187,
        38,
        197,
        80,
        19,
        250
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "NotOwner",
      "msg": "Not the contract owner"
    },
    {
      "code": 6001,
      "name": "NotAdminOrOwner",
      "msg": "Not an admin or owner"
    },
    {
      "code": 6002,
      "name": "ContractPaused",
      "msg": "Contract is paused"
    },
    {
      "code": 6003,
      "name": "PointDepositsPaused",
      "msg": "Point deposits are paused"
    },
    {
      "code": 6004,
      "name": "ZeroAddress",
      "msg": "Zero address not allowed"
    },
    {
      "code": 6005,
      "name": "ZeroAmount",
      "msg": "Amount must be greater than zero"
    },
    {
      "code": 6006,
      "name": "AlreadyOwner",
      "msg": "Already the owner"
    },
    {
      "code": 6007,
      "name": "NotPendingOwner",
      "msg": "Not the pending owner"
    },
    {
      "code": 6008,
      "name": "NoPendingTransfer",
      "msg": "No pending ownership transfer"
    },
    {
      "code": 6009,
      "name": "QuoteExpired",
      "msg": "Quote has expired"
    },
    {
      "code": 6010,
      "name": "RefConsumed",
      "msg": "Reference ID already consumed"
    },
    {
      "code": 6011,
      "name": "BadQuote",
      "msg": "Invalid quote signature"
    },
    {
      "code": 6012,
      "name": "FeeExceedsAmount",
      "msg": "Platform fee exceeds payment amount"
    },
    {
      "code": 6013,
      "name": "FeeAmountInvalid",
      "msg": "Fee amount invalid"
    },
    {
      "code": 6014,
      "name": "ZeroSigner",
      "msg": "Backend signer cannot be zero"
    },
    {
      "code": 6015,
      "name": "ZeroRecipient",
      "msg": "Recipient cannot be zero"
    },
    {
      "code": 6016,
      "name": "AmountExceedsLimit",
      "msg": "Amount exceeds spending limit"
    },
    {
      "code": 6017,
      "name": "TimelockActive",
      "msg": "Timelock is active, use queue/execute"
    },
    {
      "code": 6018,
      "name": "InsufficientBalance",
      "msg": "Insufficient balance"
    },
    {
      "code": 6019,
      "name": "DelayExceedsMax",
      "msg": "Withdrawal delay exceeds maximum"
    },
    {
      "code": 6020,
      "name": "NoDelaySet",
      "msg": "Withdrawal delay must be set before queuing"
    },
    {
      "code": 6021,
      "name": "TimelockNotExpired",
      "msg": "Withdrawal timelock not yet expired"
    },
    {
      "code": 6022,
      "name": "AlreadyExecuted",
      "msg": "Withdrawal already executed"
    },
    {
      "code": 6023,
      "name": "AlreadyCancelled",
      "msg": "Withdrawal already cancelled"
    },
    {
      "code": 6024,
      "name": "TokenNotAllowed",
      "msg": "Token not allowed for point deposits"
    },
    {
      "code": 6025,
      "name": "InvalidStringLength",
      "msg": "Invalid string length"
    },
    {
      "code": 6026,
      "name": "InvalidRefIdHash",
      "msg": "Ref ID hash mismatch"
    },
    {
      "code": 6027,
      "name": "MissingEd25519Instruction",
      "msg": "Missing Ed25519 signature instruction"
    },
    {
      "code": 6028,
      "name": "InvalidEd25519Instruction",
      "msg": "Invalid Ed25519 instruction data"
    },
    {
      "code": 6029,
      "name": "WithdrawalTypeMismatch",
      "msg": "Withdrawal type mismatch"
    },
    {
      "code": 6030,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    }
  ],
  "types": [
    {
      "name": "Admin",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "admin",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "AdminAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "AdminRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "AllowedPointToken",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "BackendSignerRotated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous",
            "type": "pubkey"
          },
          {
            "name": "next",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "Config",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "pending_owner",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "backend_signer",
            "type": "pubkey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "point_deposits_paused",
            "type": "bool"
          },
          {
            "name": "tx_counter",
            "type": "u64"
          },
          {
            "name": "point_deposit_counter",
            "type": "u64"
          },
          {
            "name": "withdrawal_delay",
            "type": "i64"
          },
          {
            "name": "withdrawal_nonce",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "ContractPausedToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "CreateTransactionParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "booking_id",
            "type": "string"
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          },
          {
            "name": "product_variant_id",
            "type": "string"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "ref_id_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MaxTransactionAmountUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MerchantBackingSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MerchantPayment",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "merchant_id",
            "type": "string"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "platform_fee_amount",
            "type": "u64"
          },
          {
            "name": "fiat_amount_minor",
            "type": "u64"
          },
          {
            "name": "fiat_currency",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "MerchantPaymentProcessed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "merchant_id",
            "type": "string"
          },
          {
            "name": "payer",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "platform_fee_amount",
            "type": "u64"
          },
          {
            "name": "fiat_amount_minor",
            "type": "u64"
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "MerchantQuoteParams",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "ref_id_hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "merchant_id",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "platform_fee_amount",
            "type": "u64"
          },
          {
            "name": "fiat_amount_minor",
            "type": "u64"
          },
          {
            "name": "fiat_currency",
            "type": {
              "array": [
                "u8",
                3
              ]
            }
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          },
          {
            "name": "expires_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "OwnershipTransferCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "cancelled_pending_owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "OwnershipTransferInitiated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "current_owner",
            "type": "pubkey"
          },
          {
            "name": "pending_owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "OwnershipTransferred",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "previous_owner",
            "type": "pubkey"
          },
          {
            "name": "new_owner",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "PlatformFeeAccount",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "accrued_amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PlatformFeesSwept",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "PointDepositCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "deposit_id",
            "type": "u64"
          },
          {
            "name": "wallet_address",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "PointDepositRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "deposit_id",
            "type": "u64"
          },
          {
            "name": "wallet_address",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PointDepositsPausedToggled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "paused",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "PointTokenAdded",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "PointTokenRemoved",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "RefRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "record_id",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SpendingLimit",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "max_amount",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "TransactionCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "tx_id",
            "type": "u64"
          },
          {
            "name": "wallet_address",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "booking_id",
            "type": "string"
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          },
          {
            "name": "product_variant_id",
            "type": "string"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "TransactionRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "tx_id",
            "type": "u64"
          },
          {
            "name": "wallet_address",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "booking_id",
            "type": "string"
          },
          {
            "name": "exchange_rate_id",
            "type": "u64"
          },
          {
            "name": "product_variant_id",
            "type": "string"
          },
          {
            "name": "ref_id",
            "type": "string"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "WithdrawEvent",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "WithdrawalCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawal_id",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "WithdrawalDelayUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "delay",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "WithdrawalExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawal_id",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "WithdrawalQueued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "withdrawal_id",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "unlock_time",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "WithdrawalRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "config",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "recipient",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "unlock_time",
            "type": "i64"
          },
          {
            "name": "executed",
            "type": "bool"
          },
          {
            "name": "cancelled",
            "type": "bool"
          },
          {
            "name": "nonce",
            "type": "u64"
          },
          {
            "name": "is_native",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ]
} as const;
