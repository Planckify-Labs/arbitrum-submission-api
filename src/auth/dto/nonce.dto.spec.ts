import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { NonceDto } from "./nonce.dto";

function run(input: Record<string, unknown>) {
  const dto = plainToInstance(NonceDto, input);
  return validate(dto);
}

describe("NonceDto", () => {
  it("accepts chainId only", async () => {
    expect(await run({ chainId: 1 })).toHaveLength(0);
  });

  it("accepts chainSlug only", async () => {
    expect(await run({ chainSlug: "solana-mainnet" })).toHaveLength(0);
  });

  it("accepts neither (EVM default fallback)", async () => {
    expect(await run({})).toHaveLength(0);
  });

  it("rejects both chainId and chainSlug set", async () => {
    const errors = await run({ chainId: 1, chainSlug: "solana-mainnet" });
    expect(errors.length).toBeGreaterThan(0);
    const flat = JSON.stringify(errors);
    expect(flat).toMatch(/mutually exclusive/);
  });

  it("rejects chainSlug with uppercase", async () => {
    const errors = await run({ chainSlug: "Solana-Mainnet" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects chainSlug with spaces", async () => {
    const errors = await run({ chainSlug: "solana mainnet" });
    expect(errors.length).toBeGreaterThan(0);
  });

  it("rejects chainSlug with trailing hyphen", async () => {
    const errors = await run({ chainSlug: "solana-" });
    expect(errors.length).toBeGreaterThan(0);
  });
});
