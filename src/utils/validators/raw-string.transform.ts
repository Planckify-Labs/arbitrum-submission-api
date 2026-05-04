import { BadRequestException } from "@nestjs/common";
import { Transform } from "class-transformer";

/**
 * Reject non-string inputs *before* class-transformer's implicit
 * conversion can silently coerce them. The global ValidationPipe runs
 * with `enableImplicitConversion: true`, which calls `String(value)` on
 * any value reflected as `string` — meaning a JSON object payload like
 * `{ "field": { "foo": "bar" } }` becomes the literal string
 * `"[object Object]"` and passes `@IsString()` / `@Length()` checks. In
 * the merchant signup path that produced rows where `payoutAccountNumber`
 * (BYTEA) literally stored `[object Object]`.
 *
 * `@Transform` receives the original *plain* object via `obj`, so
 * `obj[key]` is the un-coerced raw value. We inspect that and 400 if
 * it's not a string (or not undefined for optional fields).
 */
export function RawString({ optional = false } = {}): PropertyDecorator {
  return Transform(({ value, obj, key }) => {
    const raw = (obj as Record<string, unknown>)[key as string];
    if (raw === undefined || raw === null) {
      if (optional) return raw;
      throw new BadRequestException({
        message: `${String(key)} is required and must be a string`,
        code: "FIELD_TYPE_INVALID",
      });
    }
    if (typeof raw !== "string") {
      throw new BadRequestException({
        message: `${String(key)} must be a string`,
        code: "FIELD_TYPE_INVALID",
      });
    }
    return value;
  });
}
