import { BadRequestException, ValidationPipe } from "@nestjs/common";
import { CreateMerchantDto } from "./dto/create-merchant.dto";
import { ListChannelsQueryDto } from "./dto/list-channels-query.dto";
import { PatchMerchantDto } from "./dto/patch-merchant.dto";

/**
 * Validation-pipe smoke tests for the public `GET /v1/merchants/channels`
 * endpoint (task 28). The service-level behavior (ordering, cache,
 * DB filter) is covered in `merchants.service.spec.ts`; this file
 * pins the 400 path — a malformed `country` param is rejected by the
 * same `ValidationPipe` configuration `src/main.ts` installs globally.
 *
 * We test the DTO in isolation rather than booting
 * `MerchantsController`, because the controller transitively imports
 * `jwt-auth.guard.ts` which uses a non-relative `src/…` path that
 * Jest's current `moduleNameMapper` doesn't resolve.
 */

function makePipe(): ValidationPipe {
  // Mirror the global pipe config from `src/main.ts` so query-string
  // coercion (`country=ID` → DTO instance) happens exactly as it does
  // in production.
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: false,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });
}

describe("ListChannelsQueryDto validation (feeds GET /v1/merchants/channels)", () => {
  const pipe = makePipe();
  const metatype = {
    type: "query" as const,
    metatype: ListChannelsQueryDto,
    data: "",
  };

  it("accepts a well-formed country code (ID)", async () => {
    const out = await pipe.transform({ country: "ID" }, metatype);
    expect(out).toBeInstanceOf(ListChannelsQueryDto);
    expect(out.country).toBe("ID");
  });

  it("uppercases a lowercase country code (id → ID)", async () => {
    const out = await pipe.transform({ country: "id" }, metatype);
    expect(out.country).toBe("ID");
  });

  it("accepts an omitted country (controller will default to ID)", async () => {
    const out = await pipe.transform({}, metatype);
    expect(out.country).toBeUndefined();
  });

  it("rejects a malformed country (wrong length) with 400", async () => {
    await expect(
      pipe.transform({ country: "USA" }, metatype),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a malformed country (non-alpha) with 400", async () => {
    await expect(
      pipe.transform({ country: "1D" }, metatype),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects a malformed country (empty string) with 400", async () => {
    await expect(
      pipe.transform({ country: "" }, metatype),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

/**
 * Regression for the bug where `payoutAccountNumber: { ... }` (an object)
 * was silently coerced by `enableImplicitConversion: true` to the literal
 * string `"[object Object]"` — `@IsString()` then passed and the BYTEA
 * column was written with garbage. The DTO must 400 instead.
 */
describe("CreateMerchantDto / PatchMerchantDto reject non-string fields", () => {
  const pipe = makePipe();

  const validBody = {
    displayName: "Warung Test",
    countryCode: "ID",
    payoutChannel: "GOPAY",
    payoutAccountNumber: "+6281234567890",
    payoutAccountHolderName: "Bu Sari",
  };

  it("accepts a well-formed signup body", async () => {
    const out = await pipe.transform(validBody, {
      type: "body",
      metatype: CreateMerchantDto,
      data: "",
    });
    expect(out).toBeInstanceOf(CreateMerchantDto);
    expect(out.payoutAccountNumber).toBe("+6281234567890");
  });

  for (const field of [
    "displayName",
    "countryCode",
    "payoutChannel",
    "payoutAccountNumber",
    "payoutAccountHolderName",
  ] as const) {
    it(`rejects an object passed as ${field} with 400 (no silent String() coercion)`, async () => {
      await expect(
        pipe.transform(
          { ...validBody, [field]: { foo: "bar" } },
          { type: "body", metatype: CreateMerchantDto, data: "" },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it(`rejects a number passed as ${field} with 400`, async () => {
      await expect(
        pipe.transform(
          { ...validBody, [field]: 1234567890 },
          { type: "body", metatype: CreateMerchantDto, data: "" },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  }

  it("rejects an object passed as payoutAccountNumber on PATCH /me", async () => {
    await expect(
      pipe.transform(
        { payoutAccountNumber: { foo: "bar" } },
        { type: "body", metatype: PatchMerchantDto, data: "" },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
