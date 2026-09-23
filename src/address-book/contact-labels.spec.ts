import { loadContactLabels } from "./contact-labels";

const EVM = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
const SOL = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";

function db(entries: { address: string; label: string }[]) {
  const findMany = jest.fn().mockResolvedValue(entries);
  return { client: { addressBook: { findMany } } as never, findMany };
}

describe("loadContactLabels", () => {
  it("reads only the owner wallet's own address book", async () => {
    const { client, findMany } = db([]);
    await loadContactLabels(
      client,
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          user: {
            walletAddress: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
          },
        },
      }),
    );
  });

  it("matches EVM addresses case-insensitively", async () => {
    const { client } = db([{ address: EVM.toLowerCase(), label: "Alice" }]);
    const lookup = await loadContactLabels(client, EVM);
    expect(lookup(EVM)).toBe("Alice");
    expect(lookup(` ${EVM.toUpperCase().replace("0X", "0x")} `)).toBe("Alice");
  });

  it("keeps base58 addresses case-sensitive", async () => {
    const { client } = db([{ address: SOL, label: "Bob" }]);
    const lookup = await loadContactLabels(client, SOL);
    expect(lookup(SOL)).toBe("Bob");
    expect(lookup(SOL.toLowerCase())).toBeNull();
  });

  it("flattens and caps labels so they cannot reshape a notification", async () => {
    const { client } = db([
      { address: EVM, label: "  Mom\n(savings)\t" },
      { address: SOL, label: "A".repeat(80) },
    ]);
    const lookup = await loadContactLabels(client, EVM);
    expect(lookup(EVM)).toBe("Mom (savings)");
    expect(lookup(SOL)).toHaveLength(32);
    expect(lookup(SOL)!.endsWith("…")).toBe(true);
  });

  it("degrades to no names when the read fails or the address is missing", async () => {
    const findMany = jest.fn().mockRejectedValue(new Error("db down"));
    const lookup = await loadContactLabels(
      { addressBook: { findMany } } as never,
      EVM,
    );
    expect(lookup(EVM)).toBeNull();
    expect(lookup(null)).toBeNull();
  });
});
