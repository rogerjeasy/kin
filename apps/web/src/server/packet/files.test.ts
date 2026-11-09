import { snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import type { CircleSnapshot } from "@kin/db";
import { verifyBundle } from "@kin/verify";
import { describe, expect, it } from "vitest";

import { circleBundle } from "@/content/circle/audit-bundle";
import { circleFormatters } from "@/content/circle/format";
import { lookbackView } from "@/content/circle/lookback";
import { circleNames } from "@/content/circle/names";
import { getDictionary } from "@/i18n/dictionary";

import { buildPacket } from "./files";

const db = testDatabases();
const english = await getDictionary("en");

/** The packet's files, read back from the ZIP: it stores them uncompressed, so each file's text is in the bytes. */
function packetText(circle: CircleSnapshot): string {
  const names = circleNames(circle, english);
  const view = lookbackView(circle, []);
  const bundle = circleBundle(circle, english, names, circleFormatters("en", circle), []);
  const note = { text: "A fixed note.", provenance: { source: "template" as const, reason: "not_configured" as const }, status: "fixed" as const };
  const { zip } = buildPacket({ circle, dictionary: english, names, view, bundle, report: verifyBundle(bundle), note, proofs: [] }, "2026-10-30", circle.circle.now);
  return new TextDecoder("latin1").decode(zip);
}

describe("the visit proofs in the packet", () => {
  it("say in words where each visit's pay stands, in the spreadsheet and in the PDF, so a priced visit is never read as paid", async () => {
    const visitor = await visitorWithCircle(db);
    const seen = await snapshotFor(db, visitor.userId, visitor.circleId);
    const aide = seen.shifts.find((shift) => shift.kind === "aide");
    if (aide === undefined) throw new Error("The demo has no aide shift");
    const inAt = new Date("2026-10-30T14:00:00Z");
    const outAt = new Date("2026-10-30T16:00:00Z");
    const done = { ...aide, checkedInAt: inAt, checkedOutAt: outAt, familyConfirmedAt: outAt, familyConfirmedBy: visitor.members.rose, familyConfirmation: "parent" as const, workedMinutes: 120, cents: 4400 };
    const circle: CircleSnapshot = {
      ...seen,
      shifts: [
        { ...done, id: "00000000-0000-4000-8000-0000000000a1", state: "priced" },
        { ...done, id: "00000000-0000-4000-8000-0000000000a2", state: "paid" },
      ],
    };
    const text = packetText(circle);
    expect(text).toContain("Day,Caregiver,Checked in,Checked out,Confirmed by,Minutes worked,Pay,State,Proof");
    expect(text).toContain(`"Priced, payment not yet made",Both keys turned`);
    expect(text).toContain("Paid,Both keys turned");
    // The PDF's visit table has the same column.
    expect(text).toMatch(/\(State\)/);
    // The PDF's cell wraps word by word in its narrow column; "Priced," is written nowhere else in the packet.
    expect(text).toContain("(Priced,)");
  });
});
