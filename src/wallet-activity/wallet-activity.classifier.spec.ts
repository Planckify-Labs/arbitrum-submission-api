import {
  classifyActivity,
  formatAmount,
  walletActivityDedupeKey,
} from "./wallet-activity.classifier";
import type {
  ZerionCallbackTransaction,
  ZerionTransfer,
} from "./zerion-callback.types";

const ME = "0x42b9df65b219b3dd36ff330a4dd8f327a6ada990";
const OTHER = "0x1234567890abcdef1234567890abcdef12345678";
const ROUTER = "0x7a250d5630b4cf539739df2c5dacb4c659f2488d";
const HASH =
  "0x109d8622084d562263230ba5de412b5cd7c372019131e2c9d0a8aa4925eb6034";

const chainName = (id: string) => (id === "monad" ? "Monad" : id);

function tx(
  overrides: Partial<NonNullable<ZerionCallbackTransaction["attributes"]>>,
  chain = "monad",
): ZerionCallbackTransaction {
  return {
    type: "transactions",
    id: "abc",
    attributes: {
      hash: HASH,
      status: "confirmed",
      sent_from: ME,
      sent_to: OTHER,
      transfers: [],
      approvals: [],
      flags: { is_trash: false },
      ...overrides,
    },
    relationships: { chain: { type: "chains", id: chain } },
  };
}

function transfer(
  direction: "in" | "out",
  symbol: string,
  float: number,
  extra: Partial<ZerionTransfer> = {},
): ZerionTransfer {
  return {
    direction,
    sender: direction === "in" ? OTHER : ME,
    recipient: direction === "in" ? ME : OTHER,
    quantity: {
      float,
      int: String(Math.round(float * 1e18)),
      decimals: 18,
    },
    fungible_info: {
      symbol,
      name: symbol,
      implementations: [
        {
          chain_id: "monad",
          address:
            symbol === "MON"
              ? null
              : `0x${symbol.toLowerCase().padEnd(40, "0")}`,
          decimals: 18,
        },
      ],
    },
    ...extra,
  };
}

const classify = (t: ZerionCallbackTransaction, watched = ME) =>
  classifyActivity({ tx: t, watchedAddress: watched, chainName });

describe("classifyActivity — the swap from the MetaMask screenshot", () => {
  it("is ONE 'Swap completed' with both legs, not a sent + a received", () => {
    const plan = classify(
      tx({
        operation_type: "trade",
        sent_to: ROUTER,
        transfers: [
          transfer("out", "MON", 86, { recipient: ROUTER }),
          transfer("in", "AUSD", 2.0909, { sender: ROUTER }),
        ],
        application_metadata: { name: "Uniswap", contract_address: ROUTER },
      }),
    );
    expect(plan).not.toBeNull();
    expect(plan!.kind).toBe("trade");
    expect(plan!.title).toBe("Swap completed");
    expect(plan!.body).toBe(
      "You swapped 86 MON for 2.0909 AUSD on Monad via Uniswap.",
    );
    expect(plan!.category).toBe("wallet_activity");
    expect(plan!.iconAsset?.symbol).toBe("AUSD");
    expect(plan!.dedupeKey).toBe(walletActivityDedupeKey(HASH, ME));
  });

  it("a trade Zerion only saw one leg of falls back to the single-direction wording", () => {
    const plan = classify(
      tx({
        operation_type: "trade",
        transfers: [transfer("in", "AUSD", 2.0909)],
      }),
    );
    expect(plan!.kind).toBe("receive");
    expect(plan!.title).toBe("Transfer Received");
  });
});

describe("classifyActivity — transfers", () => {
  it("received: amount first, from a truncated counterparty, on the chain", () => {
    const plan = classify(
      tx({
        operation_type: "receive",
        sent_from: OTHER,
        sent_to: ME,
        transfers: [transfer("in", "USDC", 25)],
      }),
    );
    expect(plan!.kind).toBe("receive");
    expect(plan!.body).toBe(
      "You received 25 USDC from 0x123456...12345678 on Monad.",
    );
    expect(plan!.received).toHaveLength(1);
    expect(plan!.received[0].contractAddress).toBe(
      "0xusdc000000000000000000000000000000000000",
    );
  });

  it("sent: names the recipient; a native asset resolves to a null contract address", () => {
    const plan = classify(
      tx({ operation_type: "send", transfers: [transfer("out", "MON", 1.5)] }),
    );
    expect(plan!.kind).toBe("send");
    expect(plan!.title).toBe("Transfer Sent");
    expect(plan!.body).toBe(
      "You sent 1.5 MON to 0x123456...12345678 on Monad.",
    );
    expect(plan!.sent[0].contractAddress).toBeNull();
  });

  it("uses the app name instead of the address when the counterparty is the app's contract", () => {
    const plan = classify(
      tx({
        operation_type: "claim",
        sent_to: ROUTER,
        transfers: [transfer("in", "ARB", 12.5, { sender: ROUTER })],
        application_metadata: { name: "Aave", contract_address: ROUTER },
      }),
    );
    expect(plan!.kind).toBe("claim");
    expect(plan!.body).toBe("You claimed 12.5 ARB from Aave on Monad.");
  });

  it("direction is decided by the endpoints, not Zerion's relative `direction`", () => {
    // Rendered for the OTHER wallet, so `direction` says "out" — but the
    // recipient is us.
    const plan = classify(
      tx({
        operation_type: "send",
        sent_from: OTHER,
        sent_to: ME,
        transfers: [{ ...transfer("in", "USDC", 5), direction: "out" }],
      }),
    );
    expect(plan!.kind).toBe("receive");
  });

  it("lists up to three assets and counts the rest", () => {
    const plan = classify(
      tx({
        operation_type: "receive",
        transfers: [
          transfer("in", "A", 1),
          transfer("in", "B", 2),
          transfer("in", "C", 3),
          transfer("in", "D", 4),
        ],
      }),
    );
    expect(plan!.body).toContain("1 A, 2 B, 3 C and 1 more");
  });

  it("a self-transfer, a spam-flagged tx, and a contract call that moved nothing are all silent", () => {
    expect(
      classify(
        tx({
          operation_type: "send",
          transfers: [transfer("out", "MON", 1, { recipient: ME })],
        }),
      ),
    ).toBeNull();
    expect(
      classify(
        tx({
          operation_type: "receive",
          flags: { is_trash: true },
          transfers: [transfer("in", "SCAM", 1000000)],
        }),
      ),
    ).toBeNull();
    expect(classify(tx({ operation_type: "execute" }))).toBeNull();
    expect(classify(tx({ operation_type: "deploy" }))).toBeNull();
  });

  it("needs a hash — it is the identity of the notification", () => {
    expect(classify(tx({ hash: "" }))).toBeNull();
  });
});

describe("classifyActivity — contact names", () => {
  // Mixed case on purpose: the lookup, not the classifier, owns matching.
  const contacts = (address: string | null | undefined) =>
    address?.toLowerCase() === OTHER || address?.toLowerCase() === ROUTER
      ? "Alice"
      : null;

  it("received: a saved contact replaces the shortened sender address", () => {
    const plan = classifyActivity({
      tx: tx({
        operation_type: "receive",
        sent_from: OTHER,
        sent_to: ME,
        transfers: [transfer("in", "USDC", 25)],
      }),
      watchedAddress: ME,
      chainName,
      contactLabel: contacts,
    });
    expect(plan!.body).toBe("You received 25 USDC from Alice on Monad.");
  });

  it("sent: names the contact the funds went to", () => {
    const plan = classifyActivity({
      tx: tx({
        operation_type: "send",
        transfers: [transfer("out", "MON", 1.5)],
      }),
      watchedAddress: ME,
      chainName,
      contactLabel: contacts,
    });
    expect(plan!.body).toBe("You sent 1.5 MON to Alice on Monad.");
  });

  it("an approval never borrows a contact name for the spender", () => {
    const plan = classifyActivity({
      tx: tx({
        operation_type: "approve",
        approvals: [
          {
            sender: ROUTER,
            quantity: { float: 5, int: "5000000", decimals: 6 },
            fungible_info: { symbol: "USDC", name: "USD Coin" },
          },
        ],
      }),
      watchedAddress: ME,
      chainName,
      contactLabel: contacts,
    });
    expect(plan!.body).toContain("for 0x7a250d...59f2488d");
    expect(plan!.body).not.toContain("Alice");
  });
});

describe("classifyActivity — approvals are their own category", () => {
  it("an unlimited approval says so and asks the user to check the app", () => {
    const plan = classify(
      tx({
        operation_type: "approve",
        sent_to: "0xusdc000000000000000000000000000000000000",
        approvals: [
          {
            sender: ROUTER,
            quantity: {
              float: 1.157920892373162e59,
              int: "115792089237316195423570985008687907853269984665640564039457584007913129639935",
              decimals: 6,
            },
            fungible_info: { symbol: "USDC", name: "USD Coin" },
          },
        ],
        application_metadata: { name: "Uniswap", contract_address: ROUTER },
      }),
    );
    expect(plan!.kind).toBe("approve");
    expect(plan!.category).toBe("approvals");
    expect(plan!.title).toBe("Token approval");
    expect(plan!.body).toBe(
      "You approved unlimited USDC for Uniswap on Monad. Revoke it if you don't recognise this app.",
    );
    expect(plan!.data.unlimited).toBe(true);
  });

  it("a bounded approval shows the amount and the spender when the app is unknown", () => {
    const plan = classify(
      tx({
        operation_type: "approve",
        approvals: [
          {
            sender: OTHER,
            quantity: { float: 500, int: "500000000", decimals: 6 },
            fungible_info: { symbol: "USDC" },
          },
        ],
      }),
    );
    expect(plan!.body).toBe(
      "You approved 500 USDC for 0x123456...12345678 on Monad. Revoke it if you don't recognise this app.",
    );
  });

  it("revoke", () => {
    const plan = classify(
      tx({
        operation_type: "revoke",
        approvals: [
          {
            sender: ROUTER,
            quantity: { float: 0, int: "0", decimals: 6 },
            fungible_info: { symbol: "USDC" },
          },
        ],
        application_metadata: { name: "Uniswap", contract_address: ROUTER },
      }),
    );
    expect(plan!.kind).toBe("revoke");
    expect(plan!.body).toBe("You revoked USDC access for Uniswap on Monad.");
  });
});

describe("classifyActivity — NFTs", () => {
  const nft = (direction: "in" | "out"): ZerionTransfer => ({
    direction,
    sender: direction === "in" ? OTHER : ME,
    recipient: direction === "in" ? ME : OTHER,
    quantity: { float: 1, int: "1", decimals: 0 },
    nft_info: {
      contract_address: "0xnft",
      token_id: "10",
      name: "#10 De·genesis",
    },
  });

  it("received / sent", () => {
    expect(
      classify(tx({ operation_type: "receive", transfers: [nft("in")] }))!.body,
    ).toBe("You received #10 De·genesis from 0x123456...12345678 on Monad.");
    expect(
      classify(tx({ operation_type: "send", transfers: [nft("out")] }))!.title,
    ).toBe("NFT sent");
  });

  it("bought (NFT in, funds out) / sold (NFT out, funds in)", () => {
    const bought = classify(
      tx({
        operation_type: "trade",
        transfers: [nft("in"), transfer("out", "MON", 3)],
      }),
    );
    expect(bought!.kind).toBe("nft_buy");
    expect(bought!.body).toBe("You bought #10 De·genesis for 3 MON on Monad.");
    const sold = classify(
      tx({
        operation_type: "trade",
        transfers: [nft("out"), transfer("in", "MON", 3)],
      }),
    );
    expect(sold!.kind).toBe("nft_sell");
  });
});

describe("classifyActivity — failed transactions", () => {
  it("tells the sender nothing moved; says nothing to anyone else", () => {
    const failed = tx({
      status: "failed",
      operation_type: "trade",
      application_metadata: { name: "Uniswap", contract_address: ROUTER },
    });
    const plan = classify(failed);
    expect(plan!.kind).toBe("failed");
    expect(plan!.title).toBe("Transaction failed");
    expect(plan!.body).toBe(
      "Your transaction with Uniswap on Monad didn't go through. Nothing was moved; only the network fee was spent.",
    );
    expect(plan!.dedupeKey).toBe(`${walletActivityDedupeKey(HASH, ME)}:failed`);
    expect(classify(failed, OTHER)).toBeNull();
  });
});

describe("helpers", () => {
  it("dedupe key is case-insensitive and chain-less so both producers agree", () => {
    expect(walletActivityDedupeKey(HASH.toUpperCase(), ME)).toBe(
      walletActivityDedupeKey(HASH, ME.toUpperCase()),
    );
  });

  it("amounts read like the app's numbers", () => {
    expect(formatAmount(86)).toBe("86");
    expect(formatAmount(2.0909)).toBe("2.0909");
    expect(formatAmount(1234567.891)).toBe("1,234,567.891");
    expect(formatAmount(0.0000001)).toBe("<0.000001");
    expect(formatAmount(NaN)).toBe("0");
  });
});
