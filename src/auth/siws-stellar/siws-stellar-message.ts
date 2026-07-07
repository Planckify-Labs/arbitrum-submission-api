/**
 * Sign-In-With-Stellar (SIWS-Stellar) canonical message builder + parser.
 *
 * Mirrors `mobile-app/services/chains/stellar/` byte-for-byte (via
 * `StellarWalletKit.signAuthMessage`) and structurally mirrors
 * `siws-sui-message.ts` — same wire shape, different account-line text.
 * Divergence here means mobile signatures won't verify on the server.
 *
 * Pure module — no Nest DI — so it remains trivially unit-testable.
 *
 * Wire format (matches mobile builder):
 *   {domain} wants you to sign in with your Stellar account:
 *   {address}
 *
 *   {statement?}
 *
 *   URI: {uri}
 *   Version: 1
 *   Chain ID: {network}
 *   Nonce: {nonce}
 *   Issued At: {issuedAt}
 *   Expiration Time: {expirationTime}
 */

export type StellarSiwsNetwork = "mainnet" | "testnet";

export type SiwsStellarPayload = {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: "1";
  chainId?: StellarSiwsNetwork;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
};

export class SiwsStellarFormatError extends Error {
  public readonly code = -32602;
  constructor(message: string) {
    super(message);
    this.name = "SiwsStellarFormatError";
  }
}

function assertNoCrlf(value: string, field: string): void {
  if (/\r/.test(value)) {
    throw new SiwsStellarFormatError(`SIWS-Stellar ${field} contains CR`);
  }
}

export function buildSiwsStellarMessage(input: SiwsStellarPayload): string {
  if (!input.domain || !input.domain.trim()) {
    throw new SiwsStellarFormatError("SIWS-Stellar: domain is required");
  }
  if (!input.address || !input.address.trim()) {
    throw new SiwsStellarFormatError("SIWS-Stellar: address is required");
  }
  if (input.issuedAt && input.expirationTime) {
    const issued = Date.parse(input.issuedAt);
    const expires = Date.parse(input.expirationTime);
    if (!isNaN(issued) && !isNaN(expires) && expires <= issued) {
      throw new SiwsStellarFormatError(
        "SIWS-Stellar: expirationTime must be after issuedAt",
      );
    }
  }
  assertNoCrlf(input.domain, "domain");

  const lines: string[] = [];
  lines.push(`${input.domain} wants you to sign in with your Stellar account:`);
  lines.push(input.address);

  const statement = input.statement?.trim();
  if (statement) {
    lines.push("");
    lines.push(statement);
  }

  const fields: Array<[string, string | undefined]> = [
    ["URI", input.uri],
    ["Version", input.version],
    ["Chain ID", input.chainId],
    ["Nonce", input.nonce],
    ["Issued At", input.issuedAt],
    ["Expiration Time", input.expirationTime],
    ["Not Before", input.notBefore],
    ["Request ID", input.requestId],
  ];
  const emitted: string[] = [];
  for (const [label, value] of fields) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string" || value.length === 0) continue;
    assertNoCrlf(value, label);
    emitted.push(`${label}: ${value}`);
  }
  if (input.resources && input.resources.length > 0) {
    let block = "Resources:";
    for (const r of input.resources) {
      assertNoCrlf(r, "Resources");
      block += `\n- ${r}`;
    }
    emitted.push(block);
  }
  if (emitted.length) {
    lines.push("");
    for (const e of emitted) lines.push(e);
  }
  return lines.join("\n").replace(/[ \t]+$/gm, "");
}

export function parseSiwsStellarMessage(message: string): SiwsStellarPayload {
  if (/\r/.test(message)) {
    throw new SiwsStellarFormatError(
      "SIWS-Stellar: CRLF not allowed in signed message",
    );
  }

  const lines = message.split("\n");
  if (lines.length < 2) {
    throw new SiwsStellarFormatError("SIWS-Stellar: malformed message");
  }

  const domainMatch = lines[0].match(
    /^(.+) wants you to sign in with your Stellar account:$/,
  );
  if (!domainMatch) {
    throw new SiwsStellarFormatError("SIWS-Stellar: missing domain header");
  }
  const domain = domainMatch[1];
  const address = lines[1];

  let i = 2;
  let statement: string | undefined;

  if (lines[i] === "") {
    const next = lines[i + 1];
    const looksLikeField = next !== undefined && /^[A-Za-z ]+:\s+/.test(next);
    if (!looksLikeField) {
      const stmtLines: string[] = [];
      i += 1;
      while (i < lines.length && lines[i] !== "") {
        stmtLines.push(lines[i]);
        i += 1;
      }
      if (stmtLines.length) statement = stmtLines.join("\n");
    }
    if (lines[i] === "") i += 1;
  }

  const fields: Record<string, string> = {};
  const resources: string[] = [];
  let inResources = false;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (!l) continue;
    if (inResources && l.startsWith("- ")) {
      resources.push(l.slice(2));
      continue;
    }
    inResources = false;
    if (l === "Resources:") {
      inResources = true;
      continue;
    }
    const m = l.match(/^([A-Za-z ]+):\s+(.*)$/);
    if (m) fields[m[1]] = m[2];
  }

  const issuedAt = fields["Issued At"];
  const expirationTime = fields["Expiration Time"];
  if (issuedAt && expirationTime) {
    const issued = Date.parse(issuedAt);
    const expires = Date.parse(expirationTime);
    if (!isNaN(issued) && !isNaN(expires) && expires <= issued) {
      throw new SiwsStellarFormatError(
        "SIWS-Stellar: expirationTime must be after issuedAt",
      );
    }
  }

  const chainId = fields["Chain ID"] as StellarSiwsNetwork | undefined;

  return {
    domain,
    address,
    statement,
    uri: fields["URI"],
    version: fields["Version"] === "1" ? "1" : undefined,
    chainId,
    nonce: fields["Nonce"],
    issuedAt,
    expirationTime,
    notBefore: fields["Not Before"],
    requestId: fields["Request ID"],
    resources: resources.length ? resources : undefined,
  };
}

export function stellarChainSlugToNetwork(slug: string): StellarSiwsNetwork {
  switch (slug) {
    case "stellar-mainnet":
      return "mainnet";
    case "stellar-testnet":
      return "testnet";
    default:
      throw new SiwsStellarFormatError(
        `Unsupported Stellar chain slug: ${slug}`,
      );
  }
}
