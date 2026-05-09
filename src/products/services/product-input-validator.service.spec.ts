import { BadRequestException } from "@nestjs/common";
import type { PrismaService } from "../../prisma/prisma.service";
import { ProductInputValidatorService } from "./product-input-validator.service";

/**
 * The validator is the gate between booking input and the vendor flow, so
 * its behaviour around "no schema configured", "missing field" and
 * "type-checked field" needs explicit coverage.
 */

function buildSvc(form: unknown) {
  const prisma = {
    productInputField: {
      findFirst: jest.fn(async () =>
        form === null ? null : { id: "f1", productId: "p1", forms: form },
      ),
    },
  } as unknown as PrismaService;
  return new ProductInputValidatorService(prisma);
}

describe("ProductInputValidatorService.validateCustomerInfo", () => {
  it("returns {} when called with no customerInfo", async () => {
    const svc = buildSvc(null);
    expect(await svc.validateCustomerInfo("p1", undefined)).toEqual({});
  });

  it("returns the input verbatim when no input-field schema is configured", async () => {
    const svc = buildSvc(null);
    const info = { phone: "081" };
    expect(await svc.validateCustomerInfo("p1", info)).toEqual(info);
  });

  it("returns the input verbatim when stored schema is malformed (not an array)", async () => {
    const svc = buildSvc({ not: "an array" });
    const info = { x: "y" };
    expect(await svc.validateCustomerInfo("p1", info)).toEqual(info);
  });

  it("converts the array form to object form internally and validates", async () => {
    const svc = buildSvc([
      { key: "user_id", type: "TEXT", alias: "User ID" },
    ]);
    const out = await svc.validateCustomerInfo("p1", [
      { key: "user_id", value: "12345" },
    ]);
    expect(Array.isArray(out)).toBe(true);
  });

  it("rejects with 400 when a required field is missing", async () => {
    const svc = buildSvc([
      { key: "phone", type: "TEXT", alias: "Phone" },
    ]);
    await expect(
      svc.validateCustomerInfo("p1", { other: "x" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects when a NUMBER field cannot be coerced to a number", async () => {
    const svc = buildSvc([
      { key: "amount", type: "NUMBER", alias: "Amount" },
    ]);
    await expect(
      svc.validateCustomerInfo("p1", { amount: "not-a-number" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts a NUMBER field given as a numeric string", async () => {
    const svc = buildSvc([
      { key: "amount", type: "NUMBER", alias: "Amount" },
    ]);
    const out = await svc.validateCustomerInfo("p1", { amount: "12345" });
    expect(out).toBeDefined();
  });

  it("rejects malformed EMAIL", async () => {
    const svc = buildSvc([{ key: "email", type: "EMAIL", alias: "Email" }]);
    await expect(
      svc.validateCustomerInfo("p1", { email: "not-an-email" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts well-formed EMAIL", async () => {
    const svc = buildSvc([{ key: "email", type: "EMAIL", alias: "Email" }]);
    const out = await svc.validateCustomerInfo("p1", {
      email: "user@example.com",
    });
    expect(out).toBeDefined();
  });

  it("rejects OPTION not in the configured list", async () => {
    const svc = buildSvc([
      {
        key: "size",
        type: "OPTION",
        alias: "Size",
        options: ["S", "M", "L"],
      },
    ]);
    await expect(
      svc.validateCustomerInfo("p1", { size: "XL" }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("accepts OPTION present in the configured list", async () => {
    const svc = buildSvc([
      {
        key: "size",
        type: "OPTION",
        alias: "Size",
        options: ["S", "M", "L"],
      },
    ]);
    const out = await svc.validateCustomerInfo("p1", { size: "M" });
    expect(out).toBeDefined();
  });

  it("aggregates multiple missing fields into one 400 message", async () => {
    const svc = buildSvc([
      { key: "a", type: "TEXT", alias: "A" },
      { key: "b", type: "TEXT", alias: "B" },
    ]);
    await expect(svc.validateCustomerInfo("p1", {})).rejects.toThrow(
      /A, B/,
    );
  });
});

describe("ProductInputValidatorService.getProductInputFields", () => {
  it("returns [] when no schema is configured", async () => {
    const svc = buildSvc(null);
    expect(await svc.getProductInputFields("p1")).toEqual([]);
  });

  it("returns [] when schema isn't a JSON array", async () => {
    const svc = buildSvc({ not: "array" });
    expect(await svc.getProductInputFields("p1")).toEqual([]);
  });

  it("returns the parsed forms array", async () => {
    const forms = [{ key: "x", type: "TEXT", alias: "X" }];
    const svc = buildSvc(forms);
    expect(await svc.getProductInputFields("p1")).toEqual(forms);
  });
});
