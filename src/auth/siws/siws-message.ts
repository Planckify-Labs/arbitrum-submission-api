/**
 * Sign-In-With-Solana canonical message builder + parser.
 *
 * Mirrors `mobile-app/services/chains/solana/siws.ts` byte-for-byte.
 * Divergence here means mobile signatures won't verify on the server.
 *
 * Pure module — no Nest DI — so it remains trivially unit-testable.
 */

export type SiwsCluster = "mainnet" | "devnet" | "testnet";

export type SiwsPayload = {
  domain: string;
  address: string;
  statement?: string;
  uri?: string;
  version?: "1";
  chainId?: SiwsCluster;
  nonce?: string;
  issuedAt?: string;
  expirationTime?: string;
  notBefore?: string;
  requestId?: string;
  resources?: string[];
};

export class SiwsFormatError extends Error {
  public readonly code = -32602;
  constructor(message: string) {
    super(message);
    this.name = "SiwsFormatError";
  }
}

function assertNoCrlf(value: string, field: string): void {
  if (/\r/.test(value)) {
    throw new SiwsFormatError(`SIWS ${field} contains CR`);
  }
}

export function buildSiwsMessage(input: SiwsPayload): string {
  if (!input.domain || !input.domain.trim()) {
    throw new SiwsFormatError("SIWS: domain is required");
  }
  if (!input.address || !input.address.trim()) {
    throw new SiwsFormatError("SIWS: address is required");
  }
  if (input.issuedAt && input.expirationTime) {
    const issued = Date.parse(input.issuedAt);
    const expires = Date.parse(input.expirationTime);
    if (!isNaN(issued) && !isNaN(expires) && expires <= issued) {
      throw new SiwsFormatError("SIWS: expirationTime must be after issuedAt");
    }
  }
  assertNoCrlf(input.domain, "domain");

  const lines: string[] = [];
  lines.push(`${input.domain} wants you to sign in with your Solana account:`);
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

export function parseSiwsMessage(message: string): SiwsPayload {
  if (/\r/.test(message)) {
    throw new SiwsFormatError("SIWS: CRLF not allowed in signed message");
  }

  const lines = message.split("\n");
  if (lines.length < 2) throw new SiwsFormatError("SIWS: malformed message");

  const domainMatch = lines[0].match(
    /^(.+) wants you to sign in with your Solana account:$/,
  );
  if (!domainMatch) {
    throw new SiwsFormatError("SIWS: missing domain header");
  }
  const domain = domainMatch[1];
  const address = lines[1];

  let i = 2;
  let statement: string | undefined;

  if (lines[i] === "") {
    // The blank line after address can be either the statement separator
    // or the field-block separator (when no statement is present).
    // Peek: if the next non-blank line matches the "Label: value" field
    // pattern, treat this blank as the field separator. Otherwise it opens
    // a statement paragraph that ends at the next blank line.
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
      throw new SiwsFormatError(
        "SIWS: expirationTime must be after issuedAt",
      );
    }
  }

  const chainId = fields["Chain ID"] as SiwsCluster | undefined;

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

export function chainSlugToCluster(slug: string): SiwsCluster {
  switch (slug) {
    case "solana-mainnet":
      return "mainnet";
    case "solana-devnet":
      return "devnet";
    case "solana-testnet":
      return "testnet";
    default:
      throw new SiwsFormatError(`Unsupported Solana chain slug: ${slug}`);
  }
}
