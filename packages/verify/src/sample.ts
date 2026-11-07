import { writeFileSync } from "node:fs";

import { rosesMonth } from "@kin/domain";

import { buildBundle, claimSettlement } from "./bundle.ts";
import { entryFigures } from "./verify.ts";

/** Writes Rose's example month as an export, to try `kin-verify` on: `pnpm --filter @kin/verify run sample <file>`. */
const [path] = process.argv.slice(2);
if (path === undefined) {
  console.error("Usage: sample <file to write>");
  process.exit(2);
}
const { ledger, agreement, period } = rosesMonth;
const bundle = buildBundle({
  circleId: ledger.circleId,
  currency: ledger.currency,
  generatedOn: `${period}-30`,
  entries: ledger.entries,
  wording: ledger.entries.map((entry) => ({ entryId: entry.id, text: `${entry.description} (${entryFigures(entry)[0] ?? ""})` })),
  settlements: [claimSettlement(ledger.entries, ledger.circleId, ledger.currency, agreement, period, rosesMonth.payoutFee())],
});
writeFileSync(path, JSON.stringify(bundle, null, 2));
console.log(`Wrote ${path} (${bundle.entries.length} entries, head ${bundle.head})`);
