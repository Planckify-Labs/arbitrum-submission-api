/**
 * Collapse a voucher string to its shape: digits → 9, letter runs → a,
 * separators/punctuation kept. Two PLN tokens (different names, different
 * numbers) produce the same signature; a PLN token and a Steam key do not.
 */
export function voucherSignature(raw: string): string {
  return (
    raw
      .trim()
      // Digit groups keep their length up to 5 (code group sizes are the
      // shape); longer runs collapse.
      .replace(/[0-9]{6,}/g, "9{n}")
      .replace(/[0-9]/g, "9")
      // Letter runs collapse entirely — names vary per order.
      .replace(/[A-Za-z]+/g, "a")
      .slice(0, 200)
  );
}

/**
 * A sample ops can look at without seeing a live code: every alphanumeric
 * run longer than 3 keeps its first and last character.
 */
export function maskVoucher(raw: string): string {
  return raw
    .trim()
    .replace(
      /[A-Za-z0-9]{4,}/g,
      (run) => `${run[0]}${"•".repeat(run.length - 2)}${run[run.length - 1]}`,
    )
    .slice(0, 200);
}
