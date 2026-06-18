import { Transform } from "class-transformer";

/**
 * Query-param boolean transform that is SAFE under the global
 * `ValidationPipe({ transformOptions: { enableImplicitConversion: true } })`.
 *
 * Why this exists: with implicit conversion enabled, a property typed
 * `boolean` is coerced with `Boolean(value)` — and `Boolean("false") === true`,
 * so the query string `?flag=false` silently becomes `true`, INVERTING the
 * filter. A naive `@Transform(({ value }) => value === "false" ? false : ...)`
 * doesn't help because `value` has already been coerced to `true` by the time
 * the transform runs.
 *
 * Fix: read the RAW value from `obj[key]` (the source plain object, untouched
 * by implicit conversion), so `"false"` maps to `false`. Returns `undefined`
 * for anything unrecognised so `@IsOptional()` treats it as "not provided"
 * (no filter) rather than a bogus `false`.
 */
export function ToBoolean(): PropertyDecorator {
  return Transform(({ obj, key }) => {
    const raw = (obj as Record<string, unknown> | undefined)?.[key];
    if (raw === true || raw === "true") return true;
    if (raw === false || raw === "false") return false;
    return undefined;
  });
}
