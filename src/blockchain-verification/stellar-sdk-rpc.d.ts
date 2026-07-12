/**
 * `@stellar/stellar-sdk`'s package.json `exports` map exposes a `./rpc`
 * subpath (the Soroban RPC client, kept out of the offline-only
 * `@stellar/stellar-base` package this repo already depends on). Node
 * resolves it fine at runtime, but this repo's tsconfig uses classic/node10
 * module resolution, which predates `exports`-map support and can't see it
 * — without this shim, both `tsc` and `ts-jest` fail to find the subpath.
 *
 * Importing the top-level `@stellar/stellar-sdk` package instead (which
 * *is* resolvable under classic resolution) is not a workaround: its index
 * eagerly re-exports `federation`, which pulls in `@noble/hashes@2.2.0` —
 * an ESM-only package with no CJS build — and breaks Jest's CJS transform
 * for any test that touches this module, even indirectly.
 */
declare module "@stellar/stellar-sdk/rpc" {
  // Pure type-level re-export from the package's real (deep, exports-map-only)
  // path. This is compile-time only — it never affects what Node resolves at
  // runtime for `import ... from "@stellar/stellar-sdk/rpc"` (that's governed
  // by the package's exports map, which Node honors even though tsc can't see
  // it under this repo's module resolution mode).
  export * from "@stellar/stellar-sdk/lib/esm/rpc/index";
}
