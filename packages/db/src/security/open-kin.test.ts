import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { parseVisitReport } from "@kin/domain";

import {
  OpenKinError,
  createAgencyKey,
  grantDelegation,
  readAgencyKeys,
  readAgencyReports,
  readDelegations,
  receiveAgencyVisit,
  recordDelegationCalls,
  resolveDelegation,
  revokeAgencyKey,
  revokeDelegation,
  type GrantDelegation,
} from "../open-kin.ts";
import { readAgencyInvoices } from "../agency-invoices.ts";
import { asDelegate, asPerson } from "../scope.ts";
import { realCircle, seatPerson, visitorWithCircle, type VisitorCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { errorCode } from "../testing/sql.ts";

const db = testDatabases();
const HOUR_MS = 60 * 60 * 1000;

const person = <T>(userId: string, work: Parameters<typeof asPerson<T>>[2]) => asPerson(db.app, userId, work);
const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof OpenKinError ? error.reason : `uncoded: ${String(error)}`;
  }
};

/** A fresh token's hash and hint, and the token itself for the test to hold. */
function token() {
  const value = `kin_dlg_${randomBytes(32).toString("base64url")}`;
  return { value, hash: sha(value), hint: value.slice(-4) };
}

const grant = (userId: string, circleId: string, change: Partial<GrantDelegation> = {}) => {
  const fresh = token();
  return person(userId, (tx) =>
    grantDelegation(tx, { circleId, label: "My assistant", scope: "read", tokenHash: fresh.hash, tokenHint: fresh.hint, expiresAt: new Date(Date.now() + 7 * 24 * HOUR_MS), console: false, ...change }),
  ).then((id) => ({ id, token: fresh }));
};

async function seats(circle: VisitorCircle) {
  const [marcus, ana, daniel, amara] = await Promise.all([circle.members.marcus, circle.members.ana, circle.members.daniel, circle.members.amara].map((memberId) => seatPerson(db, circle.circleId, memberId)));
  return { elena: circle.userId, marcus: marcus as string, ana: ana as string, daniel: daniel as string, amara: amara as string };
}

describe("the demo's sample of Open Kin", () => {
  it("shows the organizer Marcus's assistant, its calls and the refused approve, and Amara's agency report, all marked seeded", async () => {
    const circle = await visitorWithCircle(db);
    const [sample] = await person(circle.userId, (tx) => readDelegations(tx, circle.circleId));
    expect(sample).toMatchObject({ memberId: circle.members.marcus, label: "Marcus's Claude", scope: "propose", seeded: true, revokedAt: null, console: false });
    expect(sample?.calls.map((call) => [call.tool, call.outcome])).toEqual([
      ["get_pool", "ok"],
      ["approve_proposal", "unknown_tool"],
      ["get_record", "ok"],
      ["list_bills", "ok"],
      ["get_fairness", "ok"],
    ]);
    const [key] = await person(circle.userId, (tx) => readAgencyKeys(tx, circle.circleId));
    expect(key).toMatchObject({ label: "Sunrise Home Care", seeded: true, revokedAt: null });
    const [report] = await person(circle.userId, (tx) => readAgencyReports(tx, circle.circleId));
    expect(report).toMatchObject({ state: "accepted", caregiverName: "Amara", caregiverMemberId: circle.members.amara, kind: "aide", seeded: true });
  });
});

describe("who sees and manages delegations", () => {
  it("lets each member see only their own, and the organizer every one", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus, ana, daniel } = await seats(circle);
    const mine = await grant(marcus, circle.circleId, { label: "Marcus's ChatGPT" });
    const read = (userId: string) => person(userId, (tx) => readDelegations(tx, circle.circleId)).then((rows) => rows.map((row) => row.id));
    expect(await read(ana)).toEqual([]);
    expect(await read(daniel)).toEqual([]);
    expect(await read(marcus)).toContain(mine.id);
    expect(await read(circle.userId)).toContain(mine.id);
    // A call is as visible as its delegation.
    await recordDelegationCalls(db.app, mine.token.hash, [{ tool: "get_pool", outcome: "ok", durationMs: 12, proposalId: null, at: new Date() }]);
    const calls = (userId: string) => person(userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from delegation_calls where delegation_id = ${mine.id}`)).then((result) => result.rows[0]?.n);
    expect(await calls(ana)).toBe("0");
    expect(await calls(marcus)).toBe("1");
  });

  it("refuses an observer, who never writes, and lets a caregiver grant one, since the scope can only narrow her role", async () => {
    const circle = await visitorWithCircle(db);
    const { daniel, amara } = await seats(circle);
    expect(await reason(grant(daniel, circle.circleId))).toBe("refused");
    const granted = await grant(amara, circle.circleId, { scope: "propose" });
    expect(await resolveDelegation(db.app, granted.token.hash)).toMatchObject({ delegationId: granted.id, role: "caregiver", scope: "propose" });
  });

  it("lets the member and the organizer revoke, and nobody else; the next resolve is refused", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus, ana, daniel } = await seats(circle);
    const first = await grant(marcus, circle.circleId);
    expect(await reason(person(ana, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: first.id })))).toBe("refused");
    expect(await reason(person(daniel, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: first.id })))).toBe("refused");
    expect(await resolveDelegation(db.app, first.token.hash)).toMatchObject({ memberId: circle.members.marcus, userId: marcus, role: "contributor", scope: "read" });
    expect(await person(marcus, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: first.id }))).toBe(true);
    expect(await person(marcus, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: first.id }))).toBe(false);
    expect(await resolveDelegation(db.app, first.token.hash)).toBeNull();
    const second = await grant(marcus, circle.circleId);
    expect(await person(circle.userId, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: second.id }))).toBe(true);
    expect(await resolveDelegation(db.app, second.token.hash)).toBeNull();
  });

  it("resolves only a live token: not an unknown one, not an expired one, not for a member who left", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus } = await seats(circle);
    expect(await resolveDelegation(db.app, sha("nobody's token"))).toBeNull();
    expect(await resolveDelegation(db.app, "not a hash")).toBeNull();
    const granted = await grant(marcus, circle.circleId);
    await db.admin.execute(sql`alter table delegations disable trigger credential_fixed`);
    try {
      await db.admin.execute(sql`update delegations set created_at = now() - interval '2 hours', expires_at = now() - interval '1 minute' where id = ${granted.id}`);
    } finally {
      await db.admin.execute(sql`alter table delegations enable trigger credential_fixed`);
    }
    expect(await resolveDelegation(db.app, granted.token.hash)).toBeNull();
    const other = await grant(marcus, circle.circleId);
    await db.admin.execute(sql`update members set status = 'left' where id = ${circle.members.marcus}`);
    expect(await resolveDelegation(db.app, other.token.hash)).toBeNull();
  });

  it("counts each use", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus } = await seats(circle);
    const granted = await grant(marcus, circle.circleId);
    await resolveDelegation(db.app, granted.token.hash);
    await resolveDelegation(db.app, granted.token.hash);
    const [row] = (await person(marcus, (tx) => readDelegations(tx, circle.circleId))).filter((each) => each.id === granted.id);
    expect(row?.uses).toBe(2);
    expect(row?.lastUsedAt).not.toBeNull();
  });

  it("holds a delegation to an hour to ninety days, five live ones a member, and a label without markup", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus } = await seats(circle);
    expect(await reason(grant(marcus, circle.circleId, { expiresAt: new Date(Date.now() + 10 * 60 * 1000) }))).toBe("invalid");
    expect(await reason(grant(marcus, circle.circleId, { expiresAt: new Date(Date.now() + 120 * 24 * HOUR_MS) }))).toBe("invalid");
    expect(await reason(grant(marcus, circle.circleId, { label: "<script>" }))).toBe("invalid");
    // The demo's sample is his first live one.
    for (let index = 0; index < 4; index += 1) await grant(marcus, circle.circleId);
    expect(await reason(grant(marcus, circle.circleId))).toBe("too_many");
  });

  it("issues the live console's delegation in a demo circle only, for fifteen minutes, replacing the last one", async () => {
    const circle = await visitorWithCircle(db);
    const soon = () => new Date(Date.now() + 15 * 60 * 1000);
    const first = await grant(circle.userId, circle.circleId, { console: true, expiresAt: soon(), scope: "propose" });
    const second = await grant(circle.userId, circle.circleId, { console: true, expiresAt: soon(), scope: "propose" });
    expect(await resolveDelegation(db.app, first.token.hash)).toBeNull();
    expect(await resolveDelegation(db.app, second.token.hash)).toMatchObject({ delegationId: second.id });
    expect(await reason(grant(circle.userId, circle.circleId, { console: true, expiresAt: new Date(Date.now() + 2 * HOUR_MS) }))).toBe("invalid");

    const real = await realCircle(db);
    expect(await reason(grant(real.userId, real.circleId, { console: true, expiresAt: soon() }))).toBe("demo_only");
  });

  it("records a call only with the token, stamped near the database's clock, and never changes one", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus } = await seats(circle);
    const granted = await grant(marcus, circle.circleId);
    expect(await reason(recordDelegationCalls(db.app, sha("someone else's"), [{ tool: "get_pool", outcome: "ok", durationMs: 1, proposalId: null, at: new Date() }]))).toBe("refused");
    expect(await reason(recordDelegationCalls(db.app, granted.token.hash, [{ tool: "get_pool", outcome: "ok", durationMs: 1, proposalId: null, at: new Date(Date.now() - 2 * HOUR_MS) }]))).toBe("refused");
    expect(await reason(recordDelegationCalls(db.app, granted.token.hash, [{ tool: "</script>", outcome: "ok", durationMs: 1, proposalId: null, at: new Date() }]))).toBe("invalid");
    await recordDelegationCalls(db.app, granted.token.hash, [{ tool: "approve_proposal", outcome: "unknown_tool", durationMs: 1, proposalId: null, at: new Date() }]);
    expect(await errorCode(db.admin.execute(sql`update delegation_calls set outcome = 'ok' where delegation_id = ${granted.id}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`delete from delegation_calls where delegation_id = ${granted.id}`))).toBe("23001");
  });

  it("never changes what a delegation says, and never un-revokes one", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus } = await seats(circle);
    const granted = await grant(marcus, circle.circleId);
    expect(await errorCode(db.admin.execute(sql`update delegations set scope = 'propose' where id = ${granted.id}`))).toBe("23001");
    await person(marcus, (tx) => revokeDelegation(tx, { circleId: circle.circleId, delegationId: granted.id }));
    expect(await errorCode(db.admin.execute(sql`update delegations set revoked_at = null, revoked_by = null where id = ${granted.id}`))).toBe("23001");
    expect(await errorCode(db.admin.execute(sql`delete from delegations where id = ${granted.id}`))).toBe("23001");
  });
});

describe("what the app's role may touch directly", () => {
  it("reads no token hash, no secret hash and no raw body, and writes no row", async () => {
    const circle = await visitorWithCircle(db);
    const run = (query: ReturnType<typeof sql>) => errorCode(person(circle.userId, (tx) => tx.execute(query)));
    expect(await run(sql`select token_hash from delegations`)).toBe("42501");
    expect(await run(sql`select secret_hash from agency_keys`)).toBe("42501");
    expect(await run(sql`select raw_body from agency_visit_reports`)).toBe("42501");
    expect(await run(sql`select raw_body from agency_invoices`)).toBe("42501");
    expect(await run(sql`insert into agency_invoices (id, circle_id, agency_key_id, raw_body, body_sha256, state, refusal) select gen_random_uuid(), circle_id, id, 'x', ${sha("x")}, 'refused', 'shape' from agency_keys limit 1`)).toBe("42501");
    expect(await run(sql`insert into agency_invoice_lines (id, circle_id, invoice_id, position, visit_report_id, minutes, amount_cents) select gen_random_uuid(), circle_id, id, 1, id, 60, 100 from agency_invoices limit 1`)).toBe("42501");
    expect(await run(sql`insert into agency_invoiced_visits (id, circle_id, visit_report_id, invoice_id) select gen_random_uuid(), circle_id, visit_report_id, invoice_id from agency_invoice_lines limit 1`)).toBe("42501");
    expect(await run(sql`update agency_invoiced_visits set released_at = now()`)).toBe("42501");
    expect(await run(sql`insert into delegations (id, circle_id, member_id, label, scope, token_hash, token_hint, expires_at) values (gen_random_uuid(), ${circle.circleId}, ${circle.members.elena}, 'x', 'read', ${sha("x")}, 'abcd', now() + interval '1 day')`)).toBe("42501");
    expect(await run(sql`update delegations set scope = 'propose'`)).toBe("42501");
    expect(await run(sql`insert into delegation_calls (id, circle_id, delegation_id, tool, outcome, duration_ms, at) select gen_random_uuid(), circle_id, id, 'approve', 'ok', 1, now() from delegations limit 1`)).toBe("42501");
    expect(await run(sql`insert into agency_visit_reports (id, circle_id, agency_key_id, raw_body, body_sha256, state, refusal) select gen_random_uuid(), circle_id, id, 'x', ${sha("x")}, 'refused', 'shape' from agency_keys limit 1`)).toBe("42501");
  });
});

describe("an approval while a member's assistant acts", () => {
  it("is refused by the database, whoever would give it, the standing permission included", async () => {
    const circle = await visitorWithCircle(db);
    const [proposal] = (await db.admin.execute<{ id: string }>(sql`select id from proposals where circle_id = ${circle.circleId} and state = 'pending_approval' limit 1`)).rows;
    const approve = (scope: typeof asPerson) =>
      scope(db.app, circle.userId, (tx) =>
        tx.execute(sql`insert into approvals (id, circle_id, proposal_id, member_id, role, decision, method, decided_at)
          values (gen_random_uuid(), ${circle.circleId}, ${proposal?.id ?? ""}, ${circle.members.elena}, 'organizer', 'approve', 'app', now())`),
      );
    expect(await errorCode(approve((database, userId, work) => asDelegate(database, userId, "a-delegation", work)))).toBe("42501");
    // Outside a delegation the same yes is the person's own, and the usual rules decide it.
    expect(await errorCode(approve(asPerson))).not.toBe("42501");
  });
});

describe("another circle", () => {
  it("can neither read nor write this circle's delegations, calls, agency keys or reports", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const count = async (table: string) => (await person(mine.userId, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from ${sql.identifier(table)} where circle_id = ${theirs.circleId}`))).rows[0]?.n;
    for (const table of ["delegations", "delegation_calls", "agency_keys", "agency_visit_reports", "agency_invoices", "agency_invoice_lines", "agency_invoiced_visits"]) expect({ table, rows: await count(table) }).toEqual({ table, rows: "0" });
    expect(await reason(grant(mine.userId, theirs.circleId))).toBe("refused");
    const [their] = await person(theirs.userId, (tx) => readDelegations(tx, theirs.circleId));
    expect(await reason(person(mine.userId, (tx) => revokeDelegation(tx, { circleId: theirs.circleId, delegationId: their?.id ?? "" })))).toBe("refused");
    expect(await reason(person(mine.userId, (tx) => createAgencyKey(tx, { circleId: theirs.circleId, label: "Agency", keyId: `agk_${"a".repeat(22)}`, secretHash: sha("s") })))).toBe("refused");
    const [theirKey] = await person(theirs.userId, (tx) => readAgencyKeys(tx, theirs.circleId));
    expect(await reason(person(mine.userId, (tx) => revokeAgencyKey(tx, { circleId: theirs.circleId, keyRowId: theirKey?.id ?? "" })))).toBe("refused");
  });
});

describe("agency keys and the visits they report", () => {
  const keyId = () => `agk_${randomBytes(16).toString("base64url")}`;
  const secret = () => `kin_ags_${randomBytes(32).toString("base64url")}`;
  const visit = (change: Record<string, string> = {}) => JSON.stringify({ externalId: `visit-${randomBytes(4).toString("hex")}`, caregiver: "Amara", kind: "aide", startsAt: "2026-11-03T14:00:00Z", endsAt: "2026-11-03T18:00:00Z", ...change });
  const send = (key: { keyId: string; secret: string }, rawBody: string) => receiveAgencyVisit(db.app, { keyId: key.keyId, secretHash: sha(key.secret), rawBody, parsed: parseVisitReport(JSON.parse(rawBody) as unknown) });

  async function newKey(circle: VisitorCircle) {
    const key = { keyId: keyId(), secret: secret() };
    const id = await person(circle.userId, (tx) => createAgencyKey(tx, { circleId: circle.circleId, label: "Sunrise Home Care", keyId: key.keyId, secretHash: sha(key.secret) }));
    return { ...key, id };
  }

  it("lets only the organizer create or revoke one; the least-privileged seats are refused", async () => {
    const circle = await visitorWithCircle(db);
    const { marcus, daniel, amara } = await seats(circle);
    for (const userId of [daniel, amara, marcus]) {
      expect(await reason(person(userId, (tx) => createAgencyKey(tx, { circleId: circle.circleId, label: "Agency", keyId: keyId(), secretHash: sha("s") })))).toBe("refused");
    }
    const key = await newKey(circle);
    expect(await reason(person(marcus, (tx) => revokeAgencyKey(tx, { circleId: circle.circleId, keyRowId: key.id })))).toBe("refused");
    expect(await person(circle.userId, (tx) => revokeAgencyKey(tx, { circleId: circle.circleId, keyRowId: key.id }))).toBe(true);
  });

  it("shows the keys to whoever sees the money, and a caregiver only the reports about her", async () => {
    const circle = await visitorWithCircle(db);
    const { daniel, amara } = await seats(circle);
    expect(await person(daniel, (tx) => readAgencyKeys(tx, circle.circleId))).toHaveLength(1);
    expect(await person(amara, (tx) => readAgencyKeys(tx, circle.circleId))).toEqual([]);
    // Today's visit and the two earlier ones Sunrise invoiced: every report in the sample is about her.
    expect((await person(amara, (tx) => readAgencyReports(tx, circle.circleId))).map((report) => report.caregiverMemberId)).toEqual([circle.members.amara, circle.members.amara, circle.members.amara]);
    // An invoice is about the money, so a caregiver reads none of them, nor their lines; the observer reads the sample.
    expect(await person(amara, (tx) => readAgencyInvoices(tx, circle.circleId))).toEqual([]);
    expect(await person(amara, (tx) => tx.execute<{ n: string }>(sql`select count(*) as n from agency_invoice_lines`)).then((result) => result.rows[0]?.n)).toBe("0");
    expect(await person(daniel, (tx) => readAgencyInvoices(tx, circle.circleId))).toHaveLength(1);
  });

  it("keeps a signed visit as evidence, matches the caregiver, and writes no shift, proposal or ledger line", async () => {
    const circle = await visitorWithCircle(db);
    const key = await newKey(circle);
    const counts = async () => (await db.admin.execute<{ s: string; p: string; l: string }>(sql`select (select count(*) from shifts where circle_id = ${circle.circleId}) as s, (select count(*) from proposals where circle_id = ${circle.circleId}) as p, (select count(*) from ledger_entries where circle_id = ${circle.circleId}) as l`)).rows[0];
    const before = await counts();
    const body = visit();
    expect(await send(key, body)).toMatchObject({ state: "accepted", duplicate: false, caregiverMatched: true });
    expect(await counts()).toEqual(before);
    // The same body again changes nothing; another body for the same visit is refused.
    expect(await send(key, body)).toMatchObject({ state: "accepted", duplicate: true });
    const id = (JSON.parse(body) as { externalId: string }).externalId;
    expect(await reason(send(key, visit({ externalId: id, endsAt: "2026-11-03T19:00:00Z" })))).toBe("conflict");
    // A name no caregiver has is kept, unmatched.
    expect(await send(key, visit({ caregiver: "Someone Else" }))).toMatchObject({ state: "accepted", caregiverMatched: false });
    // A body that is not a visit is kept as refused, with why.
    expect(await send(key, JSON.stringify({ externalId: "x", approve: true }))).toMatchObject({ state: "refused" });
    const stored = await db.admin.execute<{ raw_body: string }>(sql`select raw_body from agency_visit_reports where agency_key_id = ${key.id} and state = 'refused'`);
    expect(stored.rows[0]?.raw_body).toContain("approve");
  });

  it("refuses a wrong secret, a revoked key, and another circle's key", async () => {
    const circle = await visitorWithCircle(db);
    const key = await newKey(circle);
    expect(await reason(send({ keyId: key.keyId, secret: secret() }, visit()))).toBe("refused");
    expect(await reason(send({ keyId: keyId(), secret: key.secret }, visit()))).toBe("refused");
    await person(circle.userId, (tx) => revokeAgencyKey(tx, { circleId: circle.circleId, keyRowId: key.id }));
    expect(await reason(send(key, visit()))).toBe("refused");
  });

  it("holds five live keys a circle", async () => {
    const circle = await visitorWithCircle(db);
    for (let index = 0; index < 4; index += 1) await newKey(circle);
    expect(await reason(newKey(circle))).toBe("too_many_keys");
  });

  it("never changes a report", async () => {
    const circle = await visitorWithCircle(db);
    const key = await newKey(circle);
    await send(key, visit());
    expect(await errorCode(db.admin.execute(sql`update agency_visit_reports set minutes = 1 where agency_key_id = ${key.id}`))).toBe("23001");
  });
});
