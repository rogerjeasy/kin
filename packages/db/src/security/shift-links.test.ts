import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { hashCheckToken, mintCheckLink, newCheckToken, readCheckLink, useCheckLink } from "../check-links.ts";
import { ShiftError } from "../shift-errors.ts";
import { cancelShift, confirmShift } from "../shifts.ts";
import { settleShiftAsService } from "../shift-settlement.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, seatPerson, visitorWithCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { CLOCK, deepMessage, newShift } from "../testing/shifts.ts";
import { openAideShift, queued, realCircle, reasonOf } from "../testing/real-shifts.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();
const HOUR = 3_600_000;

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = reasonOf;
/** A link for a shift, minted as `userId`, that expires an hour after the demo clock; returns its token. */
async function mint(userId: string, circleId: string, shiftId: string, expiresAt = new Date(CLOCK.getTime() + HOUR)): Promise<string> {
  const token = newCheckToken();
  await person(userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: hashCheckToken(token), expiresAt }));
  return token;
}
const tap = (token: string, action: "in" | "out") => useCheckLink(db.app, { token, action });
const look = (token: string) => readCheckLink(db.app, { token });

describe("the token", () => {
  it("is 32 random bytes as base64url, and only its SHA-256 is ever stored", async () => {
    const token = newCheckToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(newCheckToken()).not.toBe(token);
    expect(hashCheckToken(token)).toBe(createHash("sha256").update(token).digest("hex"));
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const real = await mint(circle.userId, circle.circleId, shiftId);
    const rows = await db.admin.execute<{ row: string }>(sql`select row_to_json(l)::text as row from shift_check_links l where shift_id = ${shiftId}`);
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.row).toContain(hashCheckToken(real));
    expect(rows.rows[0]?.row).not.toContain(real);
  });
});

describe("making a link", () => {
  it("lets the shift's own member and the family make one, and nobody else", async () => {
    const circle = await visitorWithCircle(db);
    const amara = await seatPerson(db, circle.circleId, circle.members.amara);
    const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
    const other = await addMember(db, circle.circleId, "caregiver");
    const stranger = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const make = (userId: string, circleId = circle.circleId) => reason(person(userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: hashCheckToken(newCheckToken()), expiresAt: new Date(CLOCK.getTime() + HOUR) })));
    expect(await make(amara)).toBe("no error");
    expect(await make(circle.userId)).toBe("no error");
    expect(await make(daniel)).toBe("refused");
    expect(await make(other.userId)).toBe("refused");
    expect(await make(stranger.userId)).toBe("refused");
    expect(await make(stranger.userId, stranger.circleId)).toBe("refused");
    // Nothing is made for a circle's shift by a person of another circle, and no link row was written by a refusal.
    expect((await db.admin.execute(sql`select 1 from shift_check_links where shift_id = ${shiftId}`)).rows).toHaveLength(2);
  });

  it("holds the expiry between now and six hours after the shift, at five live links, and refuses a closed shift", async () => {
    const circle = await visitorWithCircle(db);
    const circleId = circle.circleId;
    const shiftId = await newShift(db, circle, { endsAt: "2026-10-30T20:00:00Z" });
    const make = (expiresAt: Date, tokenHash = hashCheckToken(newCheckToken())) => person(circle.userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash, expiresAt }));
    const at = (iso: string) => new Date(iso);
    expect(await reason(make(at("2026-10-30T17:59:59Z")))).toBe("invalid");
    expect(await reason(make(CLOCK))).toBe("invalid");
    expect(await reason(make(at("2026-10-31T02:00:01Z")))).toBe("invalid");
    expect(await reason(make(at("2026-10-31T02:00:00Z")))).toBe("no error");
    expect(await reason(person(circle.userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: "not-a-hash", expiresAt: at("2026-10-30T19:00:00Z") })))).toBe("invalid");
    // The same hash again, with the same terms, is the same link; with other terms it is a reused key.
    const hash = hashCheckToken(newCheckToken());
    const first = await person(circle.userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: hash, expiresAt: at("2026-10-30T19:00:00Z") }));
    expect(await person(circle.userId, (tx) => mintCheckLink(tx, { circleId, shiftId, tokenHash: hash, expiresAt: at("2026-10-30T19:00:00Z") }))).toBe(first);
    expect(await reason(make(at("2026-10-30T19:30:00Z"), hash))).toBe("key_reused");
    // Three live so far (the 02:00 one, this one, and none more): two more fit, the sixth does not.
    for (let n = 0; n < 3; n += 1) await make(at("2026-10-30T19:00:00Z"));
    expect(await reason(make(at("2026-10-30T19:00:00Z")))).toBe("too_many_links");
    // A cancelled shift gets none.
    const other = await newShift(db, circle);
    await person(circle.userId, (tx) => cancelShift(tx, { circleId, shiftId: other }));
    expect(await reason(person(circle.userId, (tx) => mintCheckLink(tx, { circleId, shiftId: other, tokenHash: hashCheckToken(newCheckToken()), expiresAt: at("2026-10-30T19:00:00Z") })))).toBe("wrong_state");
  });

  it("is held to the shift's own member by the database, and no role of the app reads the table", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const insert = (member: string) => db.admin.execute(sql`insert into shift_check_links (id, circle_id, shift_id, member_id, token_hash, expires_at, created_by, created_at)
      values (gen_random_uuid(), ${circle.circleId}, ${shiftId}, ${member}, ${hashCheckToken(newCheckToken())}, ${new Date(CLOCK.getTime() + HOUR).toISOString()}, ${circle.members.elena}, ${CLOCK.toISOString()})`);
    expect(await errorCode(insert(circle.members.ana))).toBe(REFUSED.foreignKey);
    expect(await errorCode(insert(circle.members.amara))).toBe("no error");
    await mint(circle.userId, circle.circleId, shiftId);
    expect((await person(circle.userId, (tx) => tx.execute(sql`select id from shift_check_links`))).rows).toEqual([]);
    expect(await errorCode(person(circle.userId, (tx) => tx.execute(sql`select token_hash from shift_check_links`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select token_hash from shift_check_links`)))).toBe(REFUSED.permission);
    expect(await errorCode(person(circle.userId, (tx) => tx.execute(sql`delete from shift_check_links`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`update shift_check_links set expires_at = now()`)))).toBe(REFUSED.permission);
  });

  it("is never readable across circles", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const shiftId = await newShift(db, theirs);
    await mint(theirs.userId, theirs.circleId, shiftId);
    const read = (userId: string) => person(userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from shift_check_links where circle_id = ${theirs.circleId}`));
    expect((await read(mine.userId)).rows[0]?.n).toBe("0");
    expect((await asService(db.service, mine.circleId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from shift_check_links where circle_id = ${theirs.circleId}`))).rows[0]?.n).toBe("0");
    expect(await errorCode(asService(db.service, mine.circleId, (tx) => tx.execute(sql`insert into shift_check_links (id, circle_id, shift_id, member_id, token_hash, expires_at, created_by) values (gen_random_uuid(), ${theirs.circleId}, ${shiftId}, ${theirs.members.amara}, ${hashCheckToken(newCheckToken())}, now(), ${theirs.members.elena})`)))).toBe(REFUSED.permission);
  });
});

describe("tapping a link with nobody signed in", () => {
  it("checks in and out for the link's member, as their own tap would, and records the link as the origin", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId);
    const came = await tap(token, "in");
    expect(came).toMatchObject({ shiftId, circleId: circle.circleId, kind: "aide", state: "checked_in", memberFirstName: expect.any(String), familyWordIn: false, action: "in", turned: true });
    expect(came.checkedInAt).toEqual(CLOCK);
    expect(await tap(token, "in")).toMatchObject({ state: "checked_in", turned: false });
    const left = await tap(token, "out");
    expect(left).toMatchObject({ state: "checked_out", turned: true });
    expect(left.checkedOutAt?.getTime()).toBeGreaterThan(CLOCK.getTime());
    const audit = await db.admin.execute<{ action: string; origin: string; member_id: string; actor: string }>(
      sql`select action, origin, member_id, actor::text from audit_log where subject_id = ${shiftId} and action like 'shift.checked_%' order by sequence`,
    );
    expect(audit.rows).toEqual([
      { action: "shift.checked_in", origin: "link", member_id: circle.members.amara, actor: "member" },
      { action: "shift.checked_out", origin: "link", member_id: circle.members.amara, actor: "member" },
    ]);
    const uses = await db.admin.execute<{ uses: number }>(sql`select uses from shift_check_links where shift_id = ${shiftId}`);
    expect(uses.rows[0]?.uses).toBe(3);
  });

  it("acts only on its own shift", async () => {
    const circle = await visitorWithCircle(db);
    const mine = await newShift(db, circle);
    const another = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, mine);
    await tap(token, "in");
    const states = await db.admin.execute<{ id: string; state: string }>(sql`select id, state::text from shifts where id in (${mine}, ${another})`);
    expect(Object.fromEntries(states.rows.map((row) => [row.id, row.state]))).toEqual({ [mine]: "checked_in", [another]: "scheduled" });
  });

  it("brings an aide's shift to confirmed with the family's word in, and queues its settling for the worker", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId);
    await tap(token, "in");
    await person(circle.userId, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId, now: CLOCK }));
    expect(await queued(db, circle.circleId, "shift.settle")).toEqual([]);
    const done = await tap(token, "out");
    expect(done).toMatchObject({ state: "confirmed", familyWordIn: true, turned: true });
    expect(await queued(db, circle.circleId, "shift.settle")).toMatchObject([{ payload: { shiftId } }]);
    // Saying it again queues nothing more.
    await tap(token, "out");
    expect(await queued(db, circle.circleId, "shift.settle")).toHaveLength(1);
    // The worker settles it with nobody signed in, and the shift is priced as for a person.
    const settled = await asService(db.service, circle.circleId, (tx) => settleShiftAsService(tx, { circleId: circle.circleId, shiftId }));
    expect(settled).toMatchObject({ outcome: "paid_by_permission", cents: 4400 });
  });

  it("queues nothing to settle while the family's word is missing, nor for a sibling's visit", async () => {
    const circle = await visitorWithCircle(db);
    const aide = await newShift(db, circle);
    const aideToken = await mint(circle.userId, circle.circleId, aide);
    await tap(aideToken, "in");
    await tap(aideToken, "out");
    const visit = await newShift(db, circle, { kind: "visit", member: "ana" });
    const visitToken = await mint(circle.userId, circle.circleId, visit);
    await tap(visitToken, "in");
    await person(circle.userId, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId: visit, now: CLOCK }));
    await tap(visitToken, "out");
    expect(await queued(db, circle.circleId, "shift.settle")).toEqual([]);
  });

  it("refuses every dead token the same way, saying nothing of whether it exists", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const expired = await mint(circle.userId, circle.circleId, shiftId, new Date(CLOCK.getTime() + HOUR));
    const cancelledShift = await newShift(db, circle);
    const cancelled = await mint(circle.userId, circle.circleId, cancelledShift);
    await person(circle.userId, (tx) => cancelShift(tx, { circleId: circle.circleId, shiftId: cancelledShift }));
    await db.admin.execute(sql`update circles set clock_at = ${new Date(CLOCK.getTime() + 2 * HOUR).toISOString()} where id = ${circle.circleId}`);
    const messages = new Set<string>();
    for (const token of [expired, cancelled, newCheckToken(), "short", "", "a".repeat(44), `${newCheckToken().slice(0, 42)}!`]) {
      const failure = await tap(token, "in").then(() => "no error", (error: unknown) => (error instanceof ShiftError ? `${error.reason}|${error.message}` : deepMessage(error)));
      expect(failure.startsWith("refused|"), token).toBe(true);
      messages.add(failure);
    }
    expect(messages.size).toBe(1);
    await expect(tap(newCheckToken(), "sideways" as "in")).rejects.toMatchObject({ reason: "refused" });
    const states = await db.admin.execute<{ id: string; state: string }>(sql`select id, state::text from shifts where id in (${shiftId}, ${cancelledShift})`);
    expect(Object.fromEntries(states.rows.map((row) => [row.id, row.state]))).toEqual({ [shiftId]: "scheduled", [cancelledShift]: "cancelled" });
  });

  it("stops a flood: six uses a minute for a link, and the minute passes", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId);
    for (let n = 0; n < 6; n += 1) await tap(token, "in");
    await expect(tap(token, "in")).rejects.toMatchObject({ reason: "refused" });
    await db.admin.execute(sql`update shift_check_links set window_started_at = now() - interval '2 minutes' where shift_id = ${shiftId}`);
    await expect(tap(token, "in")).resolves.toMatchObject({ turned: false });
  });

  it("is open to the app's role and to no other", async () => {
    const circle = await visitorWithCircle(db);
    const token = await mint(circle.userId, circle.circleId, await newShift(db, circle));
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select kin_private.use_check_link(${token}, 'in')`)))).toBe(REFUSED.permission);
    expect(await errorCode(db.provisioner.execute(sql`select kin_private.use_check_link(${token}, 'in')`))).toBe(REFUSED.permission);
  });
});

describe("looking at a link before any tap", () => {
  /** Everything a look must leave exactly as it was: the link's counters, the shift, the audit and the outbox. */
  const traces = async (shiftId: string, circleId: string) => ({
    link: (await db.admin.execute(sql`select uses, last_used_at, window_started_at, window_uses from shift_check_links where shift_id = ${shiftId}`)).rows,
    shift: (await db.admin.execute(sql`select row_to_json(s)::text as row from shifts s where id = ${shiftId}`)).rows,
    audit: (await db.admin.execute(sql`select count(*) as n from audit_log where circle_id = ${circleId}`)).rows,
    outbox: (await db.admin.execute(sql`select count(*) as n from outbox where circle_id = ${circleId}`)).rows,
  });

  it("names the caregiver, the planned times and the circle's time zone, and offers the one key that fits, at each of the four states", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId);
    const zone = (await db.admin.execute<{ timezone: string }>(sql`select timezone from circles where id = ${circle.circleId}`)).rows[0]?.timezone;
    const planned = { kind: "aide", memberFirstName: expect.any(String), timezone: zone, startsAt: new Date("2026-10-30T14:00:00Z"), endsAt: new Date("2026-10-30T20:00:00Z") };
    expect(zone).toEqual(expect.any(String));

    expect(await look(token)).toEqual({ ...planned, state: "scheduled", familyWordIn: false, next: "in" });
    await tap(token, "in");
    expect(await look(token)).toEqual({ ...planned, state: "checked_in", familyWordIn: false, next: "out" });
    await tap(token, "out");
    expect(await look(token)).toEqual({ ...planned, state: "checked_out", familyWordIn: false, next: "done" });
    await person(circle.userId, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId, now: CLOCK }));
    expect(await look(token)).toEqual({ ...planned, state: "priced", familyWordIn: true, next: "done" });
    // The tap tells the same zone.
    expect(await tap(token, "out")).toMatchObject({ timezone: zone });
  });

  it("changes nothing: no use is counted, nothing is audited or queued, and the link still has all its taps", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await newShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId);
    const before = await traces(shiftId, circle.circleId);
    for (let n = 0; n < 12; n += 1) await look(token);
    expect(await traces(shiftId, circle.circleId)).toEqual(before);
    // Twelve looks used none of the link's six taps a minute.
    for (let n = 0; n < 6; n += 1) await tap(token, "in");
    // The function declares itself read-only, so the database would refuse a write from it.
    const volatility = await db.admin.execute<{ provolatile: string }>(sql`select provolatile from pg_proc where proname = 'check_link_status'`);
    expect(volatility.rows).toEqual([{ provolatile: "s" }]);
  });

  it("refuses every dead token as the tap does: the same code and the same message, whatever is wrong", async () => {
    const circle = await visitorWithCircle(db);
    const expired = await mint(circle.userId, circle.circleId, await newShift(db, circle), new Date(CLOCK.getTime() + HOUR));
    const cancelledShift = await newShift(db, circle);
    const cancelled = await mint(circle.userId, circle.circleId, cancelledShift);
    await person(circle.userId, (tx) => cancelShift(tx, { circleId: circle.circleId, shiftId: cancelledShift }));
    const gone = await newShift(db, circle);
    const memberGone = await mint(circle.userId, circle.circleId, gone);
    await db.admin.execute(sql`update members set status = 'left' where id = ${circle.members.amara} and circle_id = ${circle.circleId}`);
    await db.admin.execute(sql`update circles set clock_at = ${new Date(CLOCK.getTime() + 2 * HOUR).toISOString()} where id = ${circle.circleId}`);
    const failureOf = (work: Promise<unknown>) => work.then(() => "no error", (error: unknown) => (error instanceof ShiftError ? `${error.reason}|${error.message}` : deepMessage(error)));
    const dead = [expired, cancelled, memberGone, newCheckToken(), "short", "", "a".repeat(44), `${newCheckToken().slice(0, 42)}!`];
    const looked = new Set<string>();
    for (const token of dead) {
      const failure = await failureOf(look(token));
      expect(failure.startsWith("refused|"), token).toBe(true);
      looked.add(failure);
      // The very message the tap gives the same token.
      expect(failure, token).toBe(await failureOf(tap(token, "in")));
    }
    expect(looked.size).toBe(1);
  });

  it("says nothing of another circle: a token shows only its own shift", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const mineShift = await newShift(db, mine, { startsAt: "2026-10-30T08:00:00Z", endsAt: "2026-10-30T19:00:00Z" });
    const theirShift = await newShift(db, theirs, { startsAt: "2026-10-30T15:00:00Z", endsAt: "2026-10-30T19:00:00Z" });
    const mineToken = await mint(mine.userId, mine.circleId, mineShift);
    const theirToken = await mint(theirs.userId, theirs.circleId, theirShift);
    const mineSees = JSON.stringify(await look(mineToken));
    const theirSees = JSON.stringify(await look(theirToken));
    expect(mineSees).toContain("2026-10-30T08:00:00.000Z");
    expect(theirSees).toContain("2026-10-30T15:00:00.000Z");
    // Neither answer carries an ID of either circle or shift, or anything of the other.
    for (const seen of [mineSees, theirSees]) {
      for (const id of [mine.circleId, theirs.circleId, mineShift, theirShift, mine.userId, theirs.userId]) expect(seen).not.toContain(id);
    }
    expect(theirSees).not.toContain("2026-10-30T08:00:00.000Z");
    expect(mineSees).not.toContain("2026-10-30T15:00:00.000Z");
    // A token of one circle's does not become another's by changing a character.
    await expect(look(`${theirToken.slice(0, 42)}${theirToken.endsWith("A") ? "B" : "A"}`)).rejects.toMatchObject({ reason: "refused" });
  });

  it("is open to the app's role and to no other, and not to everyone", async () => {
    const circle = await visitorWithCircle(db);
    const token = await mint(circle.userId, circle.circleId, await newShift(db, circle));
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select kin_private.check_link_status(${token})`)))).toBe(REFUSED.permission);
    expect(await errorCode(db.provisioner.execute(sql`select kin_private.check_link_status(${token})`))).toBe(REFUSED.permission);
    const grants = await db.admin.execute<{ app: boolean; service: boolean; everyone: boolean }>(
      sql`select has_function_privilege('kin_app', 'kin_private.check_link_status(text)', 'execute') as app,
                 has_function_privilege('kin_service', 'kin_private.check_link_status(text)', 'execute') as service,
                 has_function_privilege('public', 'kin_private.check_link_status(text)', 'execute') as everyone`,
    );
    expect(grants.rows).toEqual([{ app: true, service: false, everyone: false }]);
  });
});

describe("a link in a real circle", () => {
  it("keeps the real-circle window, the minimum visit and the closed shift, exactly as a person's tap does", async () => {
    const circle = await realCircle(db);
    const future = await newShift(db, circle, { startsAt: new Date(Date.now() + 5 * HOUR).toISOString(), endsAt: new Date(Date.now() + 8 * HOUR).toISOString() });
    const past = await newShift(db, circle, { startsAt: new Date(Date.now() - 9 * HOUR).toISOString(), endsAt: new Date(Date.now() - 5 * HOUR).toISOString() });
    const soon = await newShift(db, circle, { startsAt: new Date(Date.now() - HOUR).toISOString(), endsAt: new Date(Date.now() + 3 * HOUR).toISOString() });
    const expiry = new Date(Date.now() + HOUR / 2);
    const [futureToken, pastToken, soonToken] = await Promise.all([future, past, soon].map((shiftId) => mint(circle.userId, circle.circleId, shiftId, expiry)));
    expect(await reason(tap(futureToken ?? "", "in"))).toBe("not_started");
    expect(await reason(tap(pastToken ?? "", "in"))).toBe("wrong_state");
    expect(await reason(tap(soonToken ?? "", "out"))).toBe("wrong_state");
    await tap(soonToken ?? "", "in");
    expect(await reason(tap(soonToken ?? "", "out"))).toBe("visit_too_short");
  });

  it("checks out a visit that began long ago, and queues the settling once the family has given its word", async () => {
    const circle = await realCircle(db);
    const shiftId = await openAideShift(db, circle);
    const token = await mint(circle.userId, circle.circleId, shiftId, new Date(Date.now() + HOUR));
    await person(circle.rose, (tx) => confirmShift(tx, { circleId: circle.circleId, shiftId, now: new Date() }));
    expect(await tap(token, "out")).toMatchObject({ state: "confirmed", familyWordIn: true });
    expect(await queued(db, circle.circleId, "shift.settle")).toMatchObject([{ payload: { shiftId } }]);
  });
});
