import { entryHeadline, rosesMonth, settlePeriod } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { readCircle } from "../read-circle.ts";
import { asPerson } from "../scope.ts";
import { createDemoVisitor } from "../people.ts";
import { testDatabases } from "../testing/databases.ts";
import { provisionDemoCircle } from "./provision.ts";

const { app, provisioner } = testDatabases();

const visitor = () => createDemoVisitor(app);

describe("a provisioned demo circle", () => {
  it("reads back as Rose's month, with the same settlement the money core calculates", async () => {
    const userId = await visitor();
    const circle = await provisionDemoCircle(provisioner, userId);
    const snapshot = await asPerson(app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date() }));

    expect(snapshot.viewer).toEqual({ memberId: circle.members.elena, role: "organizer" });
    expect(snapshot.circle).toMatchObject({ name: "Rose's circle", demo: true, now: new Date("2026-10-30T18:00:00Z") });
    expect(snapshot.ledger.entries).toHaveLength(rosesMonth.ledger.entries.length);
    expect(snapshot.ledger.entries.map(entryHeadline).map((each) => each.cents)).toEqual(rosesMonth.ledger.entries.map(entryHeadline).map((each) => each.cents));

    const ours = settlePeriod({ ledger: snapshot.ledger, agreement: snapshot.agreement ?? rosesMonth.agreement, period: "2026-10", payoutFee: rosesMonth.payoutFee });
    const example = settlePeriod(rosesMonth);
    const byPersona = (memberId: string) => Object.entries(circle.members).find(([, id]) => id === memberId)?.[0] ?? memberId;
    const moves = (list: readonly { memberId: string; cents: number }[], name: (id: string) => string) =>
      list.map((each) => `${name(each.memberId)} ${each.cents}`).toSorted();
    expect(moves(ours.plan.payouts, byPersona)).toEqual(moves(example.plan.payouts, (id) => id));
    expect(moves(ours.plan.collections, byPersona)).toEqual(moves(example.plan.collections, (id) => id));

    expect(snapshot.proposals.map((p) => [p.purpose, p.state])).toEqual([
      ["stairlift", "pending_approval"],
      ["caregiverWeek", "pending_approval"],
      ...example.plan.payouts.map(() => ["settlement", "pending_approval"]),
    ]);
    expect(snapshot.proposals[0]?.votes).toEqual([{ memberId: circle.members.rose, role: "parent", decision: "approve", method: "voice", at: new Date("2026-10-29T16:10:00Z") }]);
    expect(snapshot.narrations.map((n) => n.spokenText)).toContain("Your electricity bill of $84.00 is paid.");
    expect(snapshot.claimChecks[0]).toMatchObject({ verdict: "no_match", claimedCents: 30000, alerted: [circle.members.elena, circle.members.marcus] });
  });
});
