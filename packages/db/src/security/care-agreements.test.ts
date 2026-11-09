import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { replacedBy, type CareAgreementTerms as Terms } from "@kin/domain";

import { configureCaregiver } from "../caregiver-billing.ts";
import { CareAgreementError, endCareAgreement, proposeCareAgreement, readCareAgreements, signCareAgreement, withdrawCareAgreement } from "../care-agreements.ts";
import { asPerson, asService } from "../scope.ts";
import { addMember, seatPerson, snapshotFor, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

const db = testDatabases();

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof CareAgreementError ? error.reason : `uncoded: ${String(error)}`;
  }
};
const raw = (userId: string, query: ReturnType<typeof sql>) => person(userId, (tx) => tx.execute(query));

/** A new agreement's terms for Amara, which a test changes where it needs to. */
const terms = (circle: VisitorCircle, change: Partial<Terms> = {}): Terms => ({
  payeeId: circle.payees.amara,
  caregiverMemberId: circle.members.amara,
  caregiverRelation: "not_related",
  duties: ["Help with meals", "Go with Rose to appointments"],
  weeklyMinutes: 600,
  rateCentsPerHour: 2200,
  startsOn: "2026-11-01",
  endTerm: "either_party_30_days",
  endsOn: null,
  payer: "family_members",
  state: "NY",
  ...change,
});

const propose = (circle: VisitorCircle, change: Partial<Terms> = {}) =>
  person(circle.userId, (tx) => proposeCareAgreement(tx, { circleId: circle.circleId, terms: terms(circle, change) }));
const sign = (userId: string, circle: VisitorCircle, agreementId: string) => person(userId, (tx) => signCareAgreement(tx, { circleId: circle.circleId, agreementId }));
const withdraw = (userId: string, circle: VisitorCircle, agreementId: string) => person(userId, (tx) => withdrawCareAgreement(tx, { circleId: circle.circleId, agreementId }));
const end = (userId: string, circle: VisitorCircle, agreementId: string, endedOn: string) => person(userId, (tx) => endCareAgreement(tx, { circleId: circle.circleId, agreementId, endedOn }));

/** A draft that both sides have signed: Amara, and the organizer for Rose. */
async function signedAgreement(circle: VisitorCircle, amara: string, change: Partial<Terms> = {}): Promise<string> {
  const agreementId = await propose(circle, change);
  await sign(amara, circle, agreementId);
  await sign(circle.userId, circle, agreementId);
  return agreementId;
}

/** Everyone's seat in a demo circle: the organizer, Rose, Marcus, Daniel and Amara. */
async function seats(circle: VisitorCircle) {
  const [amara, rose, marcus, daniel] = await Promise.all(
    [circle.members.amara, circle.members.rose, circle.members.marcus, circle.members.daniel].map((memberId) => seatPerson(db, circle.circleId, memberId)),
  );
  return { organizer: circle.userId, amara: amara as string, rose: rose as string, marcus: marcus as string, daniel: daniel as string };
}

const signatureCount = async (agreementId: string): Promise<number> =>
  Number((await db.admin.execute<{ n: string }>(sql`select count(*) as n from care_agreement_signatures where agreement_id = ${agreementId}`)).rows[0]?.n);

/** One row written straight into the table as the owner, so the table's own checks and triggers are what is asked. */
function insertRaw(circle: VisitorCircle, change: { relation?: string; duties?: string[]; minutes?: number; rate?: number; endTerm?: string; endsOn?: string | null; startsOn?: string; payer?: string; usState?: string; payee?: string; caregiver?: string } = {}) {
  return db.admin.execute(sql`insert into care_agreements (id, circle_id, payee_id, caregiver_member_id, caregiver_relation, duties, weekly_minutes, rate_cents_per_hour,
      starts_on, end_term, ends_on, payer, us_state, simulated, created_by)
    values (${randomUUID()}, ${circle.circleId}, ${change.payee ?? circle.payees.amara}, ${change.caregiver ?? circle.members.amara}, ${change.relation ?? "child"},
      (select coalesce(array_agg(d order by n), '{}') from jsonb_array_elements_text(${JSON.stringify(change.duties ?? ["Help with meals"])}::jsonb) with ordinality as t(d, n)), ${change.minutes ?? 600}, ${change.rate ?? 2200}, ${change.startsOn ?? "2026-11-01"}, ${change.endTerm ?? "either_party_30_days"},
      ${change.endsOn ?? null}::date, ${change.payer ?? "family_members"}, ${change.usState ?? "NY"}, true, ${circle.members.elena})`);
}

describe("who sees the care agreements", () => {
  it("shows Rose's circle Amara's signed agreement, and an active one", async () => {
    const circle = await visitorWithCircle(db);
    const snapshot = await snapshotFor(db, circle.userId, circle.circleId);
    expect(snapshot.careAgreements).toHaveLength(1);
    const [seeded] = snapshot.careAgreements;
    expect(seeded).toMatchObject({ payeeId: circle.payees.amara, caregiverMemberId: circle.members.amara, simulated: true, status: "active", state: "draft", endedOn: null });
    expect(seeded?.signatures.map((signature) => signature.capacity).toSorted()).toEqual(["caregiver", "representative"]);
    expect(seeded?.facts.signatures).toHaveLength(2);
    // Its own date, not today's: it began before the first shift of the demo.
    expect(seeded?.startsOn).toBe("2026-10-19");
  });

  it("shows a caregiver only their own, and everyone else all of them, an observer included", async () => {
    const circle = await visitorWithCircle(db);
    const { amara, daniel, marcus, rose } = await seats(circle);
    // A second caregiver with a payee and an agreement of their own.
    const other = await addMember(db, circle.circleId, "caregiver");
    const otherPayee = randomUUID();
    await db.admin.execute(sql`insert into payees (id, circle_id, name, category, status, member_id, caregiver_rate_cents_per_hour)
      values (${otherPayee}, ${circle.circleId}, 'Other aide', 'care', 'approved', ${other.memberId}, 2000)`);
    const theirs = await person(circle.userId, (tx) => proposeCareAgreement(tx, { circleId: circle.circleId, terms: terms(circle, { payeeId: otherPayee, caregiverMemberId: other.memberId, rateCentsPerHour: 2000 }) }));

    for (const userId of [circle.userId, rose, marcus, daniel]) {
      expect((await snapshotFor(db, userId, circle.circleId)).careAgreements).toHaveLength(2);
    }
    const hers = (await snapshotFor(db, amara, circle.circleId)).careAgreements;
    expect(hers).toHaveLength(1);
    expect(hers.every((agreement) => agreement.caregiverMemberId === circle.members.amara)).toBe(true);
    const own = (await snapshotFor(db, other.userId, circle.circleId)).careAgreements;
    expect(own.map((agreement) => agreement.id)).toEqual([theirs]);
    // Their signatures follow the agreement: a caregiver sees none of the other's.
    const seen = await raw(other.userId, sql`select agreement_id from care_agreement_signatures`);
    expect(seen.rows).toEqual([]);
    expect((await raw(amara, sql`select agreement_id from care_agreement_signatures`)).rows).toHaveLength(2);
    // And cannot sign the one that is not theirs.
    expect(await reason(sign(amara, circle, theirs))).toBe("refused");
  });

  it("lets another circle neither read nor write them", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const draft = await propose(theirs);
    const read = async (table: string) => (await person(mine.userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where circle_id = ${theirs.circleId}`))).rows[0]?.n;
    for (const table of ["care_agreements", "care_agreement_signatures"]) expect(await read(table)).toBe("0");
    expect(await person(mine.userId, (tx) => readCareAgreements(tx, theirs.circleId))).toEqual([]);
    expect(await reason(person(mine.userId, (tx) => proposeCareAgreement(tx, { circleId: theirs.circleId, terms: terms(theirs) })))).toBe("refused");
    expect(await reason(sign(mine.userId, theirs, draft))).toBe("refused");
    expect(await reason(withdraw(mine.userId, theirs, draft))).toBe("refused");
    expect(await reason(end(mine.userId, theirs, draft, "2026-12-31"))).toBe("refused");
    // Naming their payee in my own circle is no way in either.
    expect(await reason(person(mine.userId, (tx) => proposeCareAgreement(tx, { circleId: mine.circleId, terms: terms(mine, { payeeId: theirs.payees.amara, caregiverMemberId: theirs.members.amara }) })))).toBe("invalid");
    // Kin's service acting for my circle reaches none of theirs.
    expect((await asService(db.service, mine.circleId, (tx) => tx.execute(sql`select id from care_agreements where circle_id = ${theirs.circleId}`))).rows).toEqual([]);
  });

  it("gives no role a direct write to the tables, and the service none either", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const agreementId = await propose(circle);
    for (const userId of [circle.userId, amara]) {
      expect(await errorCode(raw(userId, sql`update care_agreements set state = 'withdrawn' where id = ${agreementId}`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`delete from care_agreements where id = ${agreementId}`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`insert into care_agreement_signatures (id, circle_id, agreement_id, member_id, capacity, method, signed_on, signed_at)
        values (gen_random_uuid(), ${circle.circleId}, ${agreementId}, ${circle.members.elena}, 'representative', 'app', '2026-10-30', now())`))).toBe(REFUSED.permission);
      expect(await errorCode(raw(userId, sql`delete from care_agreement_signatures`))).toBe(REFUSED.permission);
    }
    const asWorker = (query: ReturnType<typeof sql>) => asService(db.service, circle.circleId, (tx) => tx.execute(query));
    expect(await errorCode(asWorker(sql`update care_agreements set state = 'withdrawn' where id = ${agreementId}`))).toBe(REFUSED.permission);
    expect(await errorCode(asWorker(sql`update care_agreements set ended_on = '2026-12-31' where id = ${agreementId}`))).toBe(REFUSED.permission);
    expect(await errorCode(asWorker(sql`delete from care_agreements`))).toBe(REFUSED.permission);
    expect(await errorCode(asWorker(sql`insert into care_agreement_signatures (id, circle_id, agreement_id, member_id, capacity, method, signed_on, signed_at)
      values (gen_random_uuid(), ${circle.circleId}, ${agreementId}, ${circle.members.elena}, 'representative', 'app', '2026-10-30', now())`))).toBe(REFUSED.permission);
    // The service reads them, to hold pay to what an agreement covers.
    expect((await asWorker(sql`select id from care_agreements`)).rows).toHaveLength(2);
  });
});

describe("who may write a care agreement", () => {
  it("lets only the organizer propose, withdraw and end, and refuses every other role", async () => {
    const circle = await visitorWithCircle(db);
    const { amara, daniel, marcus, rose } = await seats(circle);
    const draft = await propose(circle);
    const signed = await signedAgreement(circle, amara, { startsOn: "2026-11-02" });
    for (const userId of [amara, daniel, marcus, rose]) {
      expect(await reason(person(userId, (tx) => proposeCareAgreement(tx, { circleId: circle.circleId, terms: terms(circle) })))).toBe("refused");
      expect(await reason(withdraw(userId, circle, draft))).toBe("refused");
      expect(await reason(end(userId, circle, signed, "2026-12-31"))).toBe("refused");
    }
  });

  it("refuses an observer and a contributor every signature, and lets the seat decide the capacity of the rest", async () => {
    const circle = await visitorWithCircle(db);
    const { amara, daniel, marcus, rose } = await seats(circle);
    const agreementId = await propose(circle);
    expect(await reason(sign(daniel, circle, agreementId))).toBe("refused");
    expect(await reason(sign(marcus, circle, agreementId))).toBe("refused");
    expect(await signatureCount(agreementId)).toBe(0);
    // The parent signs for herself, as the care recipient.
    await sign(rose, circle, agreementId);
    // The caregiver signs as the caregiver, and the organizer for the parent, as the representative.
    await sign(amara, circle, agreementId);
    await sign(circle.userId, circle, agreementId);
    const capacities = (await db.admin.execute<{ member_id: string; capacity: string }>(sql`select member_id, capacity from care_agreement_signatures where agreement_id = ${agreementId}`)).rows;
    expect(capacities.toSorted((a, b) => a.capacity.localeCompare(b.capacity))).toEqual(
      [
        { member_id: circle.members.amara, capacity: "caregiver" },
        { member_id: circle.members.rose, capacity: "care_recipient" },
        { member_id: circle.members.elena, capacity: "representative" },
      ].toSorted((a, b) => a.capacity.localeCompare(b.capacity)),
    );
  });

  it("refuses a signature given in a capacity the seat does not hold, however it is written", async () => {
    const circle = await visitorWithCircle(db);
    const agreementId = await propose(circle);
    const write = (member: string, capacity: string) =>
      db.admin.execute(sql`insert into care_agreement_signatures (id, circle_id, agreement_id, member_id, capacity, method, signed_on, signed_at)
        values (gen_random_uuid(), ${circle.circleId}, ${agreementId}, ${member}, ${capacity}, 'app', '2026-10-30', now())`);
    // The parent cannot be the caregiver or the organizer's representative; an observer can be nothing.
    expect(await errorCode(write(circle.members.rose, "caregiver"))).toBe(REFUSED.permission);
    expect(await errorCode(write(circle.members.rose, "representative"))).toBe(REFUSED.permission);
    expect(await errorCode(write(circle.members.elena, "care_recipient"))).toBe(REFUSED.permission);
    expect(await errorCode(write(circle.members.daniel, "representative"))).toBe(REFUSED.permission);
    expect(await errorCode(write(circle.members.marcus, "caregiver"))).toBe(REFUSED.permission);
    // A capacity that is no side of the agreement is refused too (the trigger answers before the table's check does).
    expect(await errorCode(write(circle.members.elena, "witness"))).toBe(REFUSED.permission);
    expect(await signatureCount(agreementId)).toBe(0);
  });

  it("signs once however often it is asked, on the circle's calendar day", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const agreementId = await propose(circle);
    await sign(circle.userId, circle, agreementId);
    await sign(circle.userId, circle, agreementId);
    await sign(amara, circle, agreementId);
    await sign(amara, circle, agreementId);
    expect(await signatureCount(agreementId)).toBe(2);
    const first = await db.admin.execute<{ signed_on: string }>(sql`select signed_on::text from care_agreement_signatures where agreement_id = ${agreementId} order by signed_at limit 1`);
    // The demo clock reads 30 October 2026, 14:00 in New York.
    expect(first.rows[0]?.signed_on).toBe("2026-10-30");
    const audited = await db.admin.execute<{ n: string }>(sql`select count(*) as n from audit_log where subject_id = ${agreementId} and action = 'care_agreement.signed'`);
    expect(Number(audited.rows[0]?.n)).toBe(2);
  });

  it("dates a signature on the circle's own clock and time zone, not the server's", async () => {
    const circle = await visitorWithCircle(db);
    // 02:30 UTC on 31 October is 22:30 on 30 October in New York.
    await db.admin.execute(sql`update circles set clock_at = '2026-10-31T02:30:00Z' where id = ${circle.circleId}`);
    const agreementId = await propose(circle);
    await sign(circle.userId, circle, agreementId);
    const row = await db.admin.execute<{ signed_on: string }>(sql`select signed_on::text from care_agreement_signatures where agreement_id = ${agreementId}`);
    expect(row.rows[0]?.signed_on).toBe("2026-10-30");
    await db.admin.execute(sql`update circles set timezone = 'Europe/Berlin' where id = ${circle.circleId}`);
    const other = await propose(circle, { startsOn: "2026-11-05" });
    await sign(circle.userId, circle, other);
    const berlin = await db.admin.execute<{ signed_on: string }>(sql`select signed_on::text from care_agreement_signatures where agreement_id = ${other}`);
    expect(berlin.rows[0]?.signed_on).toBe("2026-10-31");
  });

  it("lets only one person sign for each side", async () => {
    const circle = await visitorWithCircle(db);
    const second = await addMember(db, circle.circleId, "organizer");
    const agreementId = await propose(circle);
    await sign(circle.userId, circle, agreementId);
    expect(await reason(sign(second.userId, circle, agreementId))).toBe("signed");
    expect(await signatureCount(agreementId)).toBe(1);
  });

  it("marks the agreement simulated in a demo circle and not in a real one", async () => {
    const demo = await visitorWithCircle(db);
    const real = await visitorWithCircle(db);
    await db.admin.execute(sql`update circles set demo = false, clock_at = null where id = ${real.circleId}`);
    const flag = async (id: string) => (await db.admin.execute<{ simulated: boolean }>(sql`select simulated from care_agreements where id = ${id}`)).rows[0]?.simulated;
    expect(await flag(await propose(demo))).toBe(true);
    expect(await flag(await propose(real))).toBe(false);
  });

  it("proposes the same terms once while the draft stands, and writes the audit of it", async () => {
    const circle = await visitorWithCircle(db);
    const first = await propose(circle);
    expect(await propose(circle)).toBe(first);
    expect(await propose(circle, { weeklyMinutes: 900 })).not.toBe(first);
    const audited = await db.admin.execute<{ n: string }>(sql`select count(*) as n from audit_log where circle_id = ${circle.circleId} and action = 'care_agreement.proposed'`);
    expect(Number(audited.rows[0]?.n)).toBe(2);
  });
});

describe("the terms the database holds to", () => {
  it("refuses an agreement with a spouse, through the operation and straight into the table", async () => {
    const circle = await visitorWithCircle(db);
    expect(await reason(propose(circle, { caregiverRelation: "spouse" }))).toBe("invalid");
    expect(await errorCode(insertRaw(circle, { relation: "spouse" }))).toBe(REFUSED.check);
    expect(await errorCode(insertRaw(circle, { relation: "child" }))).toBe("no error");
  });

  it("refuses terms the template cannot hold, through the operation", async () => {
    const circle = await visitorWithCircle(db);
    const bad: Partial<Terms>[] = [
      { duties: [] },
      { duties: Array.from({ length: 13 }, (_, index) => `Duty ${index}`) },
      { duties: ["x".repeat(201)] },
      { duties: ["Help <b>now</b>"] },
      { duties: ["   "] },
      { weeklyMinutes: 0 },
      { weeklyMinutes: 5041 },
      { weeklyMinutes: 90.5 },
      { rateCentsPerHour: 0 },
      { rateCentsPerHour: -5 },
      { rateCentsPerHour: 1_000_001 },
      { startsOn: "2026-02-31" },
      { startsOn: "soon" },
      { endTerm: "fixed_end_date", endsOn: null },
      { endTerm: "fixed_end_date", endsOn: "2026-11-01" },
      { endTerm: "either_party_30_days", endsOn: "2027-01-01" },
      { endTerm: "forever" as Terms["endTerm"] },
      { payer: "the_state" as Terms["payer"] },
      { state: "ZZ" as Terms["state"] },
      { caregiverRelation: "neighbour" as Terms["caregiverRelation"] },
    ];
    for (const change of bad) expect({ change, reason: await reason(propose(circle, change)) }).toEqual({ change, reason: "invalid" });
    // Terms that fit are taken, a fixed end date among them, and a duty with the full 200 characters.
    expect(await reason(propose(circle, { endTerm: "fixed_end_date", endsOn: "2027-05-01", duties: ["x".repeat(200)] }))).toBe("no error");
  });

  it("holds the same limits in the table itself", async () => {
    const circle = await visitorWithCircle(db);
    for (const change of [
      { duties: [] },
      { duties: Array.from({ length: 13 }, (_, index) => `Duty ${index}`) },
      { duties: ["x".repeat(201)] },
      { duties: ["Help <b>now</b>"] },
      { duties: [" padded"] },
      { duties: ["trailing "] },
      { duties: [""] },
      { minutes: 0 },
      { minutes: 5041 },
      { rate: 0 },
      { endTerm: "fixed_end_date" },
      { endTerm: "fixed_end_date", endsOn: "2026-11-01" },
      { endTerm: "either_party_30_days", endsOn: "2027-01-01" },
      { payer: "somebody" },
      { usState: "ZZ" },
    ]) {
      expect({ change, code: await errorCode(insertRaw(circle, change)) }).toEqual({ change, code: REFUSED.check });
    }
    expect(await errorCode(insertRaw(circle, { duties: ["x".repeat(200), "Cook"], endTerm: "fixed_end_date", endsOn: "2027-05-01" }))).toBe("no error");
  });

  it("names a caregiver and their own payee, in the operation and in the table", async () => {
    const circle = await visitorWithCircle(db);
    expect(await reason(propose(circle, { payeeId: circle.payees.pharmacy }))).toBe("invalid");
    expect(await reason(propose(circle, { caregiverMemberId: circle.members.ana }))).toBe("invalid");
    expect(await reason(propose(circle, { caregiverMemberId: circle.members.rose }))).toBe("invalid");
    // A payee that is a caregiver's but belongs to another member of the circle.
    expect(await errorCode(insertRaw(circle, { caregiver: circle.members.ana }))).toBe(REFUSED.check);
    expect(await errorCode(insertRaw(circle, { payee: circle.payees.pharmacy }))).toBe(REFUSED.check);
    // A caregiver who has left cannot have a new agreement written.
    await db.admin.execute(sql`update members set status = 'left' where id = ${circle.members.amara}`);
    expect(await reason(propose(circle))).toBe("invalid");
  });

  it("fixes what an agreement says once it is written", async () => {
    const circle = await visitorWithCircle(db);
    const agreementId = await propose(circle);
    const change = (set: ReturnType<typeof sql>) => errorCode(db.admin.execute(sql`update care_agreements set ${set} where id = ${agreementId}`));
    expect(await change(sql`rate_cents_per_hour = 9999`)).toBe(REFUSED.restrict);
    expect(await change(sql`duties = ARRAY['Something else']`)).toBe(REFUSED.restrict);
    expect(await change(sql`starts_on = '2026-01-01'`)).toBe(REFUSED.restrict);
    expect(await change(sql`weekly_minutes = 60`)).toBe(REFUSED.restrict);
    expect(await change(sql`simulated = false`)).toBe(REFUSED.restrict);
    expect(await change(sql`caregiver_relation = 'child'`)).toBe(REFUSED.restrict);
    expect(await change(sql`payee_id = ${circle.payees.pharmacy}`)).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`delete from care_agreements where id = ${agreementId}`))).toBe(REFUSED.restrict);
    // A withdrawn agreement never comes back, and a signature is never changed or removed.
    await withdraw(circle.userId, circle, agreementId);
    expect(await change(sql`state = 'draft'`)).toBe(REFUSED.restrict);
    const signed = await signedAgreement(circle, await seatPerson(db, circle.circleId, circle.members.amara));
    expect(await errorCode(db.admin.execute(sql`update care_agreement_signatures set signed_on = '2026-01-01' where agreement_id = ${signed}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`delete from care_agreement_signatures where agreement_id = ${signed}`))).toBe(REFUSED.restrict);
  });
});

describe("withdrawing and ending", () => {
  it("withdraws a draft, once, and takes no signature on a withdrawn agreement", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const agreementId = await propose(circle);
    await sign(amara, circle, agreementId);
    await withdraw(circle.userId, circle, agreementId);
    await withdraw(circle.userId, circle, agreementId);
    const snapshot = await snapshotFor(db, circle.userId, circle.circleId);
    expect(snapshot.careAgreements.find((agreement) => agreement.id === agreementId)).toMatchObject({ state: "withdrawn", status: "withdrawn" });
    expect(await reason(sign(circle.userId, circle, agreementId))).toBe("closed");
    expect(await reason(sign(amara, circle, agreementId))).toBe("closed");
    expect(await reason(end(circle.userId, circle, agreementId, "2026-12-31"))).toBe("closed");
    const audited = await db.admin.execute<{ n: string }>(sql`select count(*) as n from audit_log where subject_id = ${agreementId} and action = 'care_agreement.withdrawn'`);
    expect(Number(audited.rows[0]?.n)).toBe(1);
  });

  it("does not withdraw an agreement both sides signed: it is ended instead", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const agreementId = await signedAgreement(circle, amara);
    expect(await reason(withdraw(circle.userId, circle, agreementId))).toBe("closed");
    // The seeded agreement, which both sides signed, cannot be withdrawn either.
    const [seeded] = (await snapshotFor(db, circle.userId, circle.circleId)).careAgreements;
    expect(seeded?.status).toBe("active");
    expect(await reason(withdraw(circle.userId, circle, seeded?.id ?? ""))).toBe("closed");
  });

  it("ends only an agreement both sides signed, not before today or before it covered work, and only once", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const agreementId = await propose(circle, { startsOn: "2026-11-03" });
    // Not signed by either side, nor by both.
    expect(await reason(end(circle.userId, circle, agreementId, "2026-12-31"))).toBe("closed");
    await sign(amara, circle, agreementId);
    expect(await reason(end(circle.userId, circle, agreementId, "2026-12-31"))).toBe("closed");
    await sign(circle.userId, circle, agreementId);
    // Today is 30 October: yesterday is past, and before the agreement's own start there is nothing to end.
    expect(await reason(end(circle.userId, circle, agreementId, "2026-10-29"))).toBe("invalid");
    expect(await reason(end(circle.userId, circle, agreementId, "2026-11-02"))).toBe("invalid");
    expect(await reason(end(circle.userId, circle, agreementId, "2026-11-03"))).toBe("no error");
    // The same day again changes nothing; another day is refused.
    expect(await reason(end(circle.userId, circle, agreementId, "2026-11-03"))).toBe("no error");
    expect(await reason(end(circle.userId, circle, agreementId, "2026-11-20"))).toBe("ended");
    expect(await errorCode(db.admin.execute(sql`update care_agreements set ended_on = '2026-11-20' where id = ${agreementId}`))).toBe(REFUSED.restrict);
    const record = (await snapshotFor(db, circle.userId, circle.circleId)).careAgreements.find((agreement) => agreement.id === agreementId);
    expect(record).toMatchObject({ endedOn: "2026-11-03", state: "draft", status: "scheduled" });
    // An ended agreement takes no more signatures and cannot be withdrawn.
    expect(await reason(withdraw(circle.userId, circle, agreementId))).toBe("closed");
    const audited = await db.admin.execute<{ n: string }>(sql`select count(*) as n from audit_log where subject_id = ${agreementId} and action = 'care_agreement.ended'`);
    expect(Number(audited.rows[0]?.n)).toBe(1);
  });

  it("reads an agreement ended today as active today and ended tomorrow", async () => {
    const circle = await visitorWithCircle(db);
    const [seeded] = (await snapshotFor(db, circle.userId, circle.circleId)).careAgreements;
    await end(circle.userId, circle, seeded?.id ?? "", "2026-10-30");
    const covered = (await snapshotFor(db, circle.userId, circle.circleId)).careAgreements[0];
    expect(covered).toMatchObject({ endedOn: "2026-10-30", status: "active" });
    await db.admin.execute(sql`update circles set clock_at = '2026-10-31T18:00:00Z' where id = ${circle.circleId}`);
    expect((await snapshotFor(db, circle.userId, circle.circleId)).careAgreements[0]?.status).toBe("ended");
  });
});

describe("one agreement at a time, at the caregiver's pay rate", () => {
  /** Amara's pay rate, set as the organizer does on the shifts screen. */
  const payRate = (circle: VisitorCircle, rateCentsPerHour: number) =>
    person(circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour }));
  const agreementsOf = async (circle: VisitorCircle) => (await snapshotFor(db, circle.userId, circle.circleId)).careAgreements;

  it("refuses to write an agreement at a rate other than the caregiver's pay rate", async () => {
    const circle = await visitorWithCircle(db);
    expect(await reason(propose(circle, { rateCentsPerHour: 3000 }))).toBe("pay_rate");
    expect(await reason(propose(circle, { rateCentsPerHour: 2199 }))).toBe("pay_rate");
    expect(await reason(propose(circle))).toBe("no error");
  });

  it("refuses every signature on a draft once the pay rate has moved away from it, and takes them at the new rate", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const stale = await propose(circle);
    await payRate(circle, 2500);
    expect(await reason(sign(amara, circle, stale))).toBe("pay_rate");
    expect(await reason(sign(circle.userId, circle, stale))).toBe("pay_rate");
    expect(await signatureCount(stale)).toBe(0);
    expect(await reason(signedAgreement(circle, amara, { rateCentsPerHour: 2500 }))).toBe("no error");
  });

  it("ends the earlier agreement the day before a newer one begins to cover work, once it is fully signed", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const [seeded] = await agreementsOf(circle);
    const newer = await propose(circle, { startsOn: "2026-11-01" });
    await sign(amara, circle, newer);
    // One signature replaces nothing.
    expect((await agreementsOf(circle)).find((agreement) => agreement.id === seeded?.id)?.endedOn).toBeNull();
    await sign(circle.userId, circle, newer);
    const after = await agreementsOf(circle);
    const old = after.find((agreement) => agreement.id === seeded?.id);
    expect(old).toMatchObject({ endedOn: "2026-10-31", status: "active" });
    if (old === undefined) throw new Error("The seeded agreement is gone");
    expect(replacedBy(old.facts, after.map((agreement) => agreement.facts))?.id).toBe(newer);
    const audited = await db.admin.execute<{ details: { replacedBy: string; endedOn: string } }>(
      sql`select details from audit_log where subject_id = ${seeded?.id ?? ""} and action = 'care_agreement.replaced'`,
    );
    expect(audited.rows).toEqual([{ details: { replacedBy: newer, endedOn: "2026-10-31" } }]);
    // A day after the clock moves, only the newer one is in force.
    await db.admin.execute(sql`update circles set clock_at = '2026-11-02T18:00:00Z' where id = ${circle.circleId}`);
    expect((await agreementsOf(circle)).map((agreement) => [agreement.id, agreement.status])).toEqual([
      [seeded?.id, "ended"],
      [newer, "active"],
    ]);
  });

  it("refuses the last signature when a signed agreement already covers the day the new one would begin", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const later = await signedAgreement(circle, amara, { startsOn: "2026-11-05" });
    const earlier = await propose(circle, { startsOn: "2026-11-01", weeklyMinutes: 900 });
    await sign(amara, circle, earlier);
    expect(await reason(sign(circle.userId, circle, earlier))).toBe("overlap");
    // Nothing of the refused signing stays: the later agreement still runs, and the earlier one waits for its second signature.
    expect(await signatureCount(earlier)).toBe(1);
    expect((await agreementsOf(circle)).find((agreement) => agreement.id === later)?.endedOn).toBeNull();
  });

  it("refuses to replace an agreement the family already ended on a later day", async () => {
    const circle = await visitorWithCircle(db);
    const { amara } = await seats(circle);
    const [seeded] = await agreementsOf(circle);
    await end(circle.userId, circle, seeded?.id ?? "", "2026-11-10");
    const newer = await propose(circle, { startsOn: "2026-11-01" });
    await sign(amara, circle, newer);
    expect(await reason(sign(circle.userId, circle, newer))).toBe("overlap");
    // Ended on or before the day the newer one begins, it is simply left alone.
    const fresh = await visitorWithCircle(db);
    const freshSeats = await seats(fresh);
    const [freshSeeded] = await agreementsOf(fresh);
    await end(fresh.userId, fresh, freshSeeded?.id ?? "", "2026-10-31");
    expect(await reason(signedAgreement(fresh, freshSeats.amara, { startsOn: "2026-11-01" }))).toBe("no error");
    expect((await agreementsOf(fresh)).find((agreement) => agreement.id === freshSeeded?.id)?.endedOn).toBe("2026-10-31");
  });
});
