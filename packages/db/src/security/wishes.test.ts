import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { WISH_TRANSITIONS, WISH_TRIGGER_TRANSITIONS, discretionaryPause, wishEffects, type WishRule } from "@kin/domain";

import { beginPayout, readPayoutJob } from "../payouts.ts";
import { asPerson, asService } from "../scope.ts";
import { checkInShift, checkOutShift, settleShift } from "../shifts.ts";
import { addMember, seatPerson, snapshotFor, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { CLOCK, newShift } from "../testing/shifts.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";
import { PARENT_SUBSCRIPTION_TRANSITIONS } from "../schema/wishes.ts";
import {
  WishError,
  addParentSubscription,
  attestWishTrigger,
  confirmWish,
  dismissWishTrigger,
  readDiscretionaryPause,
  readWishEffects,
  readWishRecording,
  readWishes,
  recordWish,
  storeWishRecording,
  withdrawWish,
  wishChainHolds,
  wishDigest,
  witnessWish,
} from "../wishes.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof WishError ? error.reason : `uncoded: ${String(error)}`;
  }
};

async function seats(circle: VisitorCircle) {
  const [rose, marcus, ana, amara, daniel] = await Promise.all(
    [circle.members.rose, circle.members.marcus, circle.members.ana, circle.members.amara, circle.members.daniel].map((memberId) => seatPerson(db, circle.circleId, memberId)),
  );
  return { elena: circle.userId, rose: rose as string, marcus: marcus as string, ana: ana as string, amara: amara as string, daniel: daniel as string };
}

const attest = (userId: string, circle: VisitorCircle, event: "hospital" | "care_home", stance: "start" | "end" = "start") =>
  person(userId, (tx) => attestWishTrigger(tx, { circleId: circle.circleId, event, stance }));
const wishesOf = (userId: string, circle: VisitorCircle) => person(userId, (tx) => readWishes(tx, circle.circleId));

/** A tiny WAV file: the RIFF header and a few silent samples. */
function wav(): Uint8Array {
  const bytes = new Uint8Array(44 + 8);
  const view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode("RIFF"), 0);
  view.setUint32(4, 36 + 8, true);
  bytes.set(new TextEncoder().encode("WAVEfmt "), 8);
  bytes.set(new TextEncoder().encode("data"), 36);
  view.setUint32(40, 8, true);
  return bytes;
}

describe("Rose's wishes in the demo", () => {
  it("are four, in force, each confirmed by her and witnessed by Elena and Marcus, with a history no one rewrote", async () => {
    const circle = await visitorWithCircle(db);
    const { wishes, triggers, subscriptions, effects } = (await snapshotFor(db, circle.userId, circle.circleId)).wishes;
    expect(wishes.map((wish) => wish.rule.kind)).toEqual(["keep_paying", "new_payee_approvals", "suspend_subscriptions", "pause_discretionary"]);
    expect(wishes.every((wish) => wish.state === "in_force" && wish.simulated && wish.recordingId === null)).toBe(true);
    for (const wish of wishes) {
      expect(wish.signatures.map((signature) => `${signature.capacity}:${signature.memberId}`).toSorted()).toEqual(
        [`parent:${circle.members.rose}`, `witness:${circle.members.elena}`, `witness:${circle.members.marcus}`].toSorted(),
      );
    }
    expect(wishes[0]?.quote).toBe("Always keep paying Amara, even if I'm in hospital.");
    expect(wishChainHolds(wishes)).toBe(true);
    expect(subscriptions.map((each) => `${each.name} ${each.state}`)).toEqual(["Lakeside Fitness active", "Garden Monthly active"]);
    expect(triggers).toEqual([]);
    expect(effects).toBeNull();
  });

  it("are sealed by the same digest the database takes", async () => {
    const circle = await visitorWithCircle(db);
    const { wishes } = (await snapshotFor(db, circle.userId, circle.circleId)).wishes;
    for (const wish of wishes) {
      const result = await db.admin.execute<{ digest: string }>(
        sql`select kin_private.wish_digest(${wish.previousDigest}, ${wish.wishKey}::uuid, ${wish.version}, ${wish.quote}, ${wish.saidOn}::date, ${wish.trigger}, ${JSON.stringify(wish.rule)}::jsonb) as digest`,
      );
      expect(result.rows[0]?.digest).toBe(wish.digest);
      expect(wishDigest(wish)).toBe(wish.digest);
    }
    // A digest over text with quotes, accents and a line break is the same on both sides.
    const rule: WishRule = { kind: "new_payee_approvals", aboveCents: 20000, approverMemberIds: [circle.members.elena, circle.members.marcus] };
    const tricky = { previousDigest: "a".repeat(64), wishKey: circle.circleId, version: 2, quote: 'Ne payez "personne" — sauf Amara\\Élise', saidOn: "2026-11-01", trigger: "either" as const, rule };
    const fromSql = await db.admin.execute<{ digest: string }>(
      sql`select kin_private.wish_digest(${tricky.previousDigest}, ${tricky.wishKey}::uuid, ${2}, ${tricky.quote}, ${tricky.saidOn}::date, ${tricky.trigger}, ${JSON.stringify(rule)}::jsonb) as digest`,
    );
    expect(fromSql.rows[0]?.digest).toBe(wishDigest(tricky));
  });
});

describe("who reads her wishes", () => {
  it("lets the family read them and her subscriptions, and a caregiver only the triggers", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    for (const userId of [people.elena, people.rose, people.marcus, people.daniel]) expect((await wishesOf(userId, circle)).wishes).toHaveLength(4);
    const amaras = await wishesOf(people.amara, circle);
    expect(amaras.wishes).toEqual([]);
    expect(amaras.subscriptions).toEqual([]);
    await attest(people.amara, circle, "hospital");
    expect((await wishesOf(people.amara, circle)).triggers).toHaveLength(1);
    const raw = (table: string) => person(people.amara, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)}`));
    for (const table of ["wishes", "wish_signatures", "wish_recordings", "parent_subscriptions"]) expect((await raw(table)).rows[0]?.n).toBe("0");
  });

  it("lets another circle neither read nor write any of it", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    await attest(theirs.userId, theirs, "hospital");
    const read = async (table: string) =>
      (await person(mine.userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where circle_id = ${theirs.circleId}`))).rows[0]?.n;
    for (const table of ["wishes", "wish_signatures", "wish_recordings", "wish_triggers", "wish_attestations", "parent_subscriptions"]) expect(await read(table)).toBe("0");
    // Their operations act only in a circle the person sits in.
    expect(await reason(attest(mine.userId, theirs, "hospital"))).toBe("refused");
    const [theirWish] = (await snapshotFor(db, theirs.userId, theirs.circleId)).wishes.wishes;
    expect(await reason(person(mine.userId, (tx) => witnessWish(tx, { circleId: theirs.circleId, wishId: theirWish?.id ?? "" })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => addParentSubscription(tx, { circleId: theirs.circleId, name: "Gym", monthlyCents: 100, paypalSubscriptionId: null })))).toBe("refused");
    // No one writes the tables directly.
    for (const table of ["wishes", "wish_triggers", "parent_subscriptions"]) {
      expect(await errorCode(person(mine.userId, (tx) => tx.execute(sql`update ${sql.identifier(table)} set state = state where circle_id = ${mine.circleId}`)))).toBe(REFUSED.permission);
    }
    expect(await errorCode(person(mine.userId, (tx) => tx.execute(sql`delete from wishes where circle_id = ${mine.circleId}`)))).toBe(REFUSED.permission);
  });
});

describe("saying, confirming and witnessing a wish", () => {
  it("is hers alone to say, and two family members who share the cost put it in force", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const draft = { circleId: circle.circleId, quote: "Keep my phone line paid.", trigger: "hospital" as const, rule: { kind: "pause_discretionary" } as WishRule, recordingId: null, wishKey: null };
    for (const userId of [people.elena, people.marcus, people.amara, people.daniel]) expect(await reason(person(userId, (tx) => recordWish(tx, draft)))).toBe("refused");
    const id = await person(people.rose, (tx) => recordWish(tx, draft));
    // A witness signs only what she confirmed.
    expect(await reason(person(people.elena, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id })))).toBe("closed");
    expect(await reason(person(people.elena, (tx) => confirmWish(tx, { circleId: circle.circleId, wishId: id, method: "app" })))).toBe("refused");
    await person(people.rose, (tx) => confirmWish(tx, { circleId: circle.circleId, wishId: id, method: "app" }));
    for (const userId of [people.rose, people.amara, people.daniel]) expect(await reason(person(userId, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id })))).toBe("refused");
    expect(await person(people.elena, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }))).toBe("confirmed");
    // The same witness twice is still one.
    expect(await person(people.elena, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }))).toBe("confirmed");
    expect(await person(people.ana, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }))).toBe("in_force");
  });

  it("keeps a change as a new version chained to the old, which it supersedes only once witnessed", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const [first] = (await wishesOf(people.rose, circle)).wishes;
    if (!first) throw new Error("No wish");
    const id = await person(people.rose, (tx) =>
      recordWish(tx, { circleId: circle.circleId, quote: "Keep paying Amara, always.", trigger: "either", rule: first.rule, recordingId: null, wishKey: first.wishKey }),
    );
    // One change waits at a time.
    expect(await reason(person(people.rose, (tx) => recordWish(tx, { circleId: circle.circleId, quote: "Again", trigger: "either", rule: first.rule, recordingId: null, wishKey: first.wishKey })))).toBe("waiting");
    await person(people.rose, (tx) => confirmWish(tx, { circleId: circle.circleId, wishId: id, method: "voice" }));
    expect((await wishesOf(people.rose, circle)).wishes.find((wish) => wish.id === first.id)?.state).toBe("in_force");
    await person(people.elena, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }));
    await person(people.marcus, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }));
    const after = (await wishesOf(people.rose, circle)).wishes.filter((wish) => wish.wishKey === first.wishKey);
    expect(after.map((wish) => `${wish.version} ${wish.state}`)).toEqual(["1 superseded", "2 in_force"]);
    expect(after[1]?.previousDigest).toBe(first.digest);
    expect(wishChainHolds(after)).toBe(true);
    // What a version says never changes, even by its owner role.
    expect(await errorCode(db.admin.execute(sql`update wishes set quote = 'Pay me' where id = ${id}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update wishes set state = 'draft' where id = ${id}`))).toBe(REFUSED.check);
    expect(await errorCode(db.admin.execute(sql`delete from wish_signatures where wish_id = ${id}`))).toBe(REFUSED.restrict);
  });

  it("refuses a rule the record cannot hold, and a successor witnessing the wish that names them", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const say = (rule: unknown) => person(people.rose, (tx) => recordWish(tx, { circleId: circle.circleId, quote: "Words", trigger: "hospital", rule: rule as WishRule, recordingId: null, wishKey: null }));
    expect(await reason(say({ kind: "keep_paying", payeeId: circle.payees.gas }))).toBe("invalid");
    expect(await reason(say({ kind: "new_payee_approvals", aboveCents: 100, approverMemberIds: [circle.members.elena, circle.members.amara] }))).toBe("invalid");
    expect(await reason(say({ kind: "new_payee_approvals", aboveCents: 1.5, approverMemberIds: [circle.members.elena, circle.members.marcus] }))).toBe("invalid");
    expect(await reason(say({ kind: "pause_discretionary", extra: true }))).toBe("invalid");
    expect(await reason(say({ kind: "pay_everyone" }))).toBe("invalid");
    const id = await say({ kind: "successor", memberId: circle.members.marcus });
    await person(people.rose, (tx) => confirmWish(tx, { circleId: circle.circleId, wishId: id, method: "app" }));
    expect(await reason(person(people.marcus, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id })))).toBe("refused");
  });

  it("keeps her own recording for the family, and no one else's", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    expect(await reason(person(people.elena, (tx) => storeWishRecording(tx, { circleId: circle.circleId, wav: wav() })))).toBe("refused");
    expect(await reason(person(people.rose, (tx) => storeWishRecording(tx, { circleId: circle.circleId, wav: new Uint8Array(60) })))).toBe("invalid");
    const recordingId = await person(people.rose, (tx) => storeWishRecording(tx, { circleId: circle.circleId, wav: wav() }));
    const id = await person(people.rose, (tx) =>
      recordWish(tx, { circleId: circle.circleId, quote: "Keep the heating on.", trigger: "either", rule: { kind: "pause_discretionary" }, recordingId, wishKey: null }),
    );
    expect((await wishesOf(people.elena, circle)).wishes.find((wish) => wish.id === id)?.recordingId).toBe(recordingId);
    expect((await person(people.daniel, (tx) => readWishRecording(tx, { circleId: circle.circleId, recordingId })))?.audio).toEqual(wav());
    expect(await person(people.amara, (tx) => readWishRecording(tx, { circleId: circle.circleId, recordingId }))).toBeNull();
  });
});

describe("a trigger, attested by people", () => {
  it("is reported by one, made active by a second, applies her wishes, freezes them, and ends when two say she is home", async () => {
    const circle = await visitorWithCircle(db);
    const other = await visitorWithCircle(db);
    const people = await seats(circle);
    // Never the parent, never an observer.
    for (const userId of [people.rose, people.daniel]) expect(await reason(attest(userId, circle, "hospital"))).toBe("refused");
    expect((await attest(people.elena, circle, "hospital")).state).toBe("reported");
    expect((await attest(people.elena, circle, "hospital")).state).toBe("reported");
    expect(await person(people.elena, (tx) => readWishEffects(tx, circle.circleId))).toBeNull();
    expect(await reason(attest(people.marcus, circle, "care_home"))).toBe("other_event");
    expect((await attest(people.marcus, circle, "hospital")).state).toBe("active");
    expect(await reason(attest(people.ana, circle, "hospital"))).toBe("active");

    const snapshot = await wishesOf(people.elena, circle);
    expect(snapshot.subscriptions.map((each) => each.state)).toEqual(["suspended", "suspended"]);
    expect(snapshot.effects?.keepPaying.map((each) => each.payeeId)).toEqual([circle.payees.amara]);
    expect((await asService(db.service, circle.circleId, (tx) => readDiscretionaryPause(tx, circle.circleId))).paused).toBe(true);
    // Another circle is untouched.
    expect((await asService(db.service, other.circleId, (tx) => readDiscretionaryPause(tx, other.circleId))).paused).toBe(false);
    // The plain code in the domain and the database agree on what changed.
    const expected = wishEffects(snapshot.wishes.filter((wish) => wish.state === "in_force"), snapshot.effects?.trigger ?? null);
    expect(snapshot.subscriptions.filter((each) => each.state === "suspended").map((each) => each.id).toSorted()).toEqual(expected?.subscriptions.map((each) => each.subscriptionId).toSorted());
    expect(discretionaryPause(expected).paused).toBe(true);

    // While it is open, her wishes stay as they are.
    const [first] = snapshot.wishes;
    expect(await reason(person(people.rose, (tx) => withdrawWish(tx, { circleId: circle.circleId, wishId: first?.id ?? "" })))).toBe("frozen");
    expect(await reason(person(people.rose, (tx) => recordWish(tx, { circleId: circle.circleId, quote: "Pay Theo", trigger: "either", rule: { kind: "pause_discretionary" }, recordingId: null, wishKey: null })))).toBe("frozen");

    expect(await reason(attest(people.elena, circle, "hospital", "end"))).toBe("no error");
    expect((await wishesOf(people.elena, circle)).triggers[0]?.state).toBe("active");
    // Amara may attest a hospital stay, so her word with Elena's ends it.
    expect((await attest(people.amara, circle, "hospital", "end")).state).toBe("ended");
    const after = await wishesOf(people.elena, circle);
    expect(after.subscriptions.map((each) => each.state)).toEqual(["active", "active"]);
    expect(after.effects).toBeNull();
    expect(await reason(attest(people.elena, circle, "hospital", "end"))).toBe("nothing_active");
  });

  it("takes two family members for a care home: the caregiver's word does not count", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    expect(await reason(attest(people.amara, circle, "care_home"))).toBe("refused");
    await attest(people.elena, circle, "care_home");
    expect((await attest(people.ana, circle, "care_home")).state).toBe("active");
  });

  it("lets the reporter or the organizer take back a report nobody confirmed, and no one else", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const { triggerId } = await attest(people.marcus, circle, "hospital");
    expect(await reason(person(people.ana, (tx) => dismissWishTrigger(tx, { circleId: circle.circleId, triggerId })))).toBe("refused");
    await person(people.elena, (tx) => dismissWishTrigger(tx, { circleId: circle.circleId, triggerId }));
    expect((await wishesOf(people.elena, circle)).triggers[0]?.state).toBe("dismissed");
    // A dismissed report is history; a new one starts again from one person.
    expect((await attest(people.ana, circle, "hospital")).state).toBe("reported");
  });

  it("seats the successor she named while it lasts, and gives the seat back when she is home", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const id = await person(people.rose, (tx) => recordWish(tx, { circleId: circle.circleId, quote: "If I can't decide, Marcus runs things.", trigger: "hospital", rule: { kind: "successor", memberId: circle.members.marcus }, recordingId: null, wishKey: null }));
    await person(people.rose, (tx) => confirmWish(tx, { circleId: circle.circleId, wishId: id, method: "app" }));
    await person(people.elena, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }));
    await person(people.ana, (tx) => witnessWish(tx, { circleId: circle.circleId, wishId: id }));
    const role = async (memberId: string) => (await db.admin.execute<{ role: string }>(sql`select role::text from members where id = ${memberId}`)).rows[0]?.role;
    await attest(people.elena, circle, "hospital");
    await attest(people.ana, circle, "hospital");
    expect([await role(circle.members.elena), await role(circle.members.marcus)]).toEqual(["contributor", "organizer"]);
    await attest(people.ana, circle, "hospital", "end");
    await attest(people.marcus, circle, "hospital", "end");
    expect([await role(circle.members.elena), await role(circle.members.marcus)]).toEqual(["organizer", "contributor"]);
  });
});

describe("her wishes and the money", () => {
  async function shiftPayout(circle: VisitorCircle, amara: string): Promise<string> {
    const circleId = circle.circleId;
    const shiftId = await newShift(db, circle);
    await person(amara, (tx) => checkInShift(tx, { circleId, shiftId }));
    await person(amara, (tx) => checkOutShift(tx, { circleId, shiftId, now: CLOCK }));
    await person(circle.userId, (tx) => tx.execute(sql`select kin_private.confirm_shift(${circleId}::uuid, ${shiftId}::uuid)`));
    await person(circle.userId, (tx) => settleShift(tx, { circleId, shiftId }));
    const rows = await db.admin.execute<{ id: string }>(sql`select e.id from executions e join shifts s on s.proposal_id = e.proposal_id where s.id = ${shiftId}`);
    const executionId = rows.rows[0]?.id;
    if (!executionId) throw new Error("No payout");
    return executionId;
  }
  const begin = (circle: VisitorCircle, executionId: string) =>
    asService(db.service, circle.circleId, async (tx) => {
      const job = await readPayoutJob(tx, executionId, CLOCK);
      if (!job) throw new Error("No job");
      return beginPayout(tx, job, 0);
    });

  it("pays Amara's shift while Rose is in hospital, because she said so", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    await attest(people.elena, circle, "hospital");
    await attest(people.marcus, circle, "hospital");
    expect(await begin(circle, await shiftPayout(circle, people.amara))).toBe("ready");
  });

  it("holds a caregiver no keep-paying wish names, while her wishes pause what is not care", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const keep = (await wishesOf(people.rose, circle)).wishes.find((wish) => wish.rule.kind === "keep_paying");
    await person(people.rose, (tx) => withdrawWish(tx, { circleId: circle.circleId, wishId: keep?.id ?? "" }));
    const executionId = await shiftPayout(circle, people.amara);
    await attest(people.elena, circle, "hospital");
    await attest(people.marcus, circle, "hospital");
    expect(await begin(circle, executionId)).toBe("wish_hold");
    // Once she is home, it goes.
    await attest(people.elena, circle, "hospital", "end");
    await attest(people.marcus, circle, "hospital", "end");
    expect(await begin(circle, executionId)).toBe("ready");
  });
});

describe("subscriptions she pays", () => {
  it("are added by the organizer only, simulated in a demo circle, and never change what they are", async () => {
    const circle = await visitorWithCircle(db);
    const people = await seats(circle);
    const add = (userId: string, paypal: string | null = null) => person(userId, (tx) => addParentSubscription(tx, { circleId: circle.circleId, name: "Daily paper", monthlyCents: 2200, paypalSubscriptionId: paypal }));
    for (const userId of [people.rose, people.marcus, people.daniel, people.amara]) expect(await reason(add(userId))).toBe("refused");
    expect(await reason(add(people.elena, "I-BW452GLLEP1G"))).toBe("invalid");
    const id = await add(people.elena);
    expect(await errorCode(db.admin.execute(sql`update parent_subscriptions set monthly_cents = 1 where id = ${id}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`update parent_subscriptions set state = 'resuming' where id = ${id}`))).toBe(REFUSED.check);
  });
});

describe("the state machines", () => {
  it("hold in the database exactly the moves the domain lists", async () => {
    const rows = await db.admin.execute<{ machine: string; from_state: string; to_state: string }>(
      sql`select machine, from_state, to_state from kin_private.state_transitions where machine in ('wish', 'wish_trigger', 'parent_subscription')`,
    );
    const stored = rows.rows.map((row) => `${row.machine} ${row.from_state}>${row.to_state}`).toSorted();
    const listed = Object.entries({ wish: WISH_TRANSITIONS, wish_trigger: WISH_TRIGGER_TRANSITIONS, parent_subscription: PARENT_SUBSCRIPTION_TRANSITIONS })
      .flatMap(([machine, table]) => Object.entries(table).flatMap(([from, tos]) => (tos as readonly string[]).map((to) => `${machine} ${from}>${to}`)))
      .toSorted();
    expect(stored).toEqual(listed);
  });

  it("let one person's role list stay as the members table holds it", async () => {
    const circle = await visitorWithCircle(db);
    const extra = await addMember(db, circle.circleId, "contributor");
    expect((await attest(extra.userId, circle, "care_home")).state).toBe("reported");
  });
});
