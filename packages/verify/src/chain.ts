import { createHash } from "node:crypto";

import type { LedgerEntry } from "@kin/domain";

/** The same text for the same value, whatever order its keys were written in. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).toSorted();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

const sha256 = (text: string): string => createHash("sha256").update(text).digest("hex");

/** Where every circle's chain starts: the circle's own name, so chains cannot be swapped between circles. */
export const genesisHash = (circleId: string): string => sha256(`kin-chain-v1:${circleId}`);

/** An entry's hash covers its whole content and the hash before it, so changing any past entry changes every hash after it. */
export const entryHash = (previous: string, entry: LedgerEntry): string => sha256(`${previous}\n${canonicalJson(entry)}`);

/** The hash of each entry in order; the last one is the chain's head. */
export function chainHashes(circleId: string, entries: readonly LedgerEntry[]): string[] {
  const hashes: string[] = [];
  let previous = genesisHash(circleId);
  for (const entry of entries) {
    previous = entryHash(previous, entry);
    hashes.push(previous);
  }
  return hashes;
}
