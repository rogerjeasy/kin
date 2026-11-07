import { decimalAmount } from "@kin/domain";

import type { VerificationReport } from "./verify.ts";

/** The one-page verdict the command prints. */
export function renderVerdict(report: VerificationReport): string {
  const lines = [
    `Kin record verification: ${report.ok ? "PASS" : "FAIL"}`,
    `Circle ${report.circleId} - ${report.entryCount} entries - pool ${decimalAmount({ cents: report.poolCents, currency: report.currency })} ${report.currency}`,
    `Chain head ${report.head}`,
    report.keptHeads.count === 0 ? "No earlier heads were kept with this export" : `Checked against ${report.keptHeads.count} head(s) Kin kept earlier, the oldest on ${report.keptHeads.oldest?.slice(0, 10) ?? "unknown"}`,
    "",
    ...report.checks.map((check) => `${check.ok ? "ok  " : "FAIL"} ${check.id.padEnd(10)} ${check.detail}`),
  ];
  if (report.observations.length > 0) {
    lines.push("", "Worth a second look (not a failure):");
    lines.push(...report.observations.map((each) => `  - ${each.code}${each.entryId === null ? "" : ` at ${each.entryId}`}`));
  }
  return lines.join("\n");
}
