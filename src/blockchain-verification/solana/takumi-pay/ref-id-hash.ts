import { createHash } from "crypto";

export function computeRefIdHash(refId: string): Uint8Array {
  return new Uint8Array(createHash("sha256").update(refId).digest());
}
