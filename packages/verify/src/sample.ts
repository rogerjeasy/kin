import { writeFileSync } from "node:fs";

import { rosesMonth } from "@kin/domain";

import { buildBundle, claimSettlement } from "./bundle.ts";
import { chainHashes } from "./chain.ts";
import { entryFigures } from "./verify.ts";

/** Writes Rose's example month as an export, to try `kin-verify` on: `pnpm --filter @kin/verify run sample <file>`. */
const [path] = process.argv.slice(2);
if (path === undefined) {
  console.error("Usage: sample <file to write>");
  process.exit(2);
}
const { ledger, agreement, period } = rosesMonth;
const hashes = chainHashes(ledger.circleId, ledger.entries);
const bundle = buildBundle({
  // A head Kin would have kept at an earlier visit: after the first half of the record.
  heads: [{ count: Math.floor(ledger.entries.length / 2), head: hashes[Math.floor(ledger.entries.length / 2) - 1] ?? "", recordedAt: `${period}-15T09:00:00.000Z` }],
  circleId: ledger.circleId,
  currency: ledger.currency,
  generatedOn: `${period}-30`,
  entries: ledger.entries,
  wording: ledger.entries.map((entry) => ({ entryId: entry.id, text: `${entry.description} (${entryFigures(entry)[0] ?? ""})` })),
  settlements: [claimSettlement(ledger.entries, ledger.circleId, ledger.currency, agreement, period, rosesMonth.payoutFee())],
});
writeFileSync(path, JSON.stringify(bundle, null, 2));
console.log(`Wrote ${path} (${bundle.entries.length} entries, head ${bundle.head})`);
