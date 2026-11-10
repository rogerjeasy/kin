import { entryHeadline, rosesMonth, settlePeriod } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { readCircle } from "../read-circle.ts";
import { asPerson } from "../scope.ts";
import { createDemoVisitor } from "../people.ts";
import { DEMO_LEDGER_ENTRIES } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { provisionDemoCircle } from "./provision.ts";
import { ROSES_CIRCLE } from "./roses-circle.ts";

const { app, provisioner } = testDatabases();

const visitor = () => createDemoVisitor(app);

describe("a provisioned demo circle", () => {
  it("reads back as Rose's month, with the same settlement the money core calculates", async () => {
    const userId = await visitor();
    const circle = await provisionDemoCircle(provisioner, userId, ROSES_CIRCLE.clockAt);
    const snapshot = await asPerson(app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: new Date() }));

    expect(snapshot.viewer).toEqual({ memberId: circle.members.elena, role: "organizer" });
    expect(snapshot.circle).toMatchObject({ name: "Rose's circle", demo: true, now: new Date("2026-10-30T18:00:00Z") });
    expect(snapshot.ledger.entries).toHaveLength(DEMO_LEDGER_ENTRIES);
    // Rose's month, then this week's float into her Purse: fifty dollars moved inside the pool's account, simulated.
    const month = snapshot.ledger.entries.filter((entry) => entry.kind !== "purse_funded");
    expect(month.map(entryHeadline).map((each) => each.cents)).toEqual(rosesMonth.ledger.entries.map(entryHeadline).map((each) => each.cents));
    expect(snapshot.ledger.entries.filter((entry) => entry.kind === "purse_funded").map((entry) => [entryHeadline(entry).cents, entry.simulated, entry.period])).toEqual([[5_000, true, "2026-10"]]);

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
    // Nothing in the demo says money was paid that the ledger does not hold: no settled proposal, no paid shift, no confirmed payout.
    expect(snapshot.proposals.filter((p) => p.state === "settled" || p.state === "executing")).toEqual([]);
    expect(snapshot.shifts.filter((shift) => shift.state === "paid" || shift.proposalId !== null)).toEqual([]);
    expect(snapshot.shiftPermissions.flatMap((permission) => permission.uses)).toEqual([]);
    expect(snapshot.proposals[0]?.votes).toEqual([{ memberId: circle.members.rose, role: "parent", decision: "approve", method: "voice", at: new Date("2026-10-29T16:10:00Z") }]);
    expect(snapshot.narrations.map((n) => n.spokenText)).toContain("Your electricity bill of $84.00 is paid.");
    expect(snapshot.claimChecks[0]).toMatchObject({ verdict: "no_match", claimedCents: 30000, alerted: [circle.members.elena, circle.members.marcus] });
  });

  it("is moved to the moment the visitor pressed the Demo button: today on the clock, the month ending now", async () => {
    const userId = await visitor();
    // A mid-December afternoon in New York: 47 days after the template's clock, in another month.
    const pressed = new Date("2026-12-16T20:15:00Z");
    const circle = await provisionDemoCircle(provisioner, userId, pressed);
    const snapshot = await asPerson(app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: pressed }));

    expect(snapshot.circle.now).toEqual(pressed);
    const days = snapshot.ledger.entries.map((entry) => entry.occurredOn).toSorted();
    expect(days.at(0)).toBe("2026-11-17");
    expect(days.at(-1)).toBe("2026-12-16");
    expect(new Set(snapshot.ledger.entries.map((entry) => entry.period))).toEqual(new Set(["2026-12"]));

    // The same money and the same settlement, for the period open on the new clock.
    const ours = settlePeriod({ ledger: snapshot.ledger, agreement: snapshot.agreement ?? rosesMonth.agreement, period: "2026-12", payoutFee: rosesMonth.payoutFee });
    expect(ours.plan.payouts.map((each) => each.cents).toSorted()).toEqual(settlePeriod(rosesMonth).plan.payouts.map((each) => each.cents).toSorted());

    // Nothing has happened after the clock, and nothing waiting has expired.
    const waiting = snapshot.proposals.filter((proposal) => proposal.state === "pending_approval");
    expect(waiting).toHaveLength(snapshot.proposals.length);
    expect(snapshot.proposals.every((proposal) => proposal.raisedAt <= pressed)).toBe(true);
    expect(waiting.every((proposal) => proposal.expiresAt !== null && proposal.expiresAt > pressed)).toBe(true);
    expect(waiting[0]?.votes[0]?.at).toEqual(new Date("2026-12-15T18:25:00Z"));
    expect(snapshot.narrations.every((narration) => narration.saidOn <= "2026-12-16")).toBe(true);
  });
});
