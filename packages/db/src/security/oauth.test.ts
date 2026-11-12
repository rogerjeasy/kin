import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { OAuthConsentError, createAuthorizationCode, redeemAuthorizationCode, type AuthorizationCodeInput, type RedeemInput } from "../oauth.ts";
import { grantDelegation, readDelegations, resolveDelegation } from "../open-kin.ts";
import { asPerson, asService } from "../scope.ts";
import { seatPerson, visitorWithCircle } from "../testing/index.ts";
import { testDatabases } from "../testing/databases.ts";
import { REFUSED, errorCode } from "../testing/sql.ts";

/**
 * OAuth for Kin's MCP server (decision 112), at the database: a member's yes
 * is a sixty-second code for their own seat, traded once, by the holder of
 * the PKCE verifier, the client ID and the redirect URI, for a delegation
 * that is exactly like one granted on the screen. No role reads a code.
 */

const db = testDatabases();
const RESOURCE = "https://kin.example/api/mcp";
const CLIENT = "kin_cli_example.signature";
const REDIRECT = "http://127.0.0.1:33418/callback";

const sha = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const challengeOf = (verifier: string) => createHash("sha256").update(verifier).digest("base64url");
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof OAuthConsentError ? error.reason : `uncoded: ${String(error)}`;
  }
};

/** A real circle (not a demo), with Marcus and Daniel the observer seated before it was made real, as only a demo circle seats a visitor. */
async function realCircleWithSeats() {
  const circle = await visitorWithCircle(db);
  const marcus = await seatPerson(db, circle.circleId, circle.members.marcus);
  const daniel = await seatPerson(db, circle.circleId, circle.members.daniel);
  await db.admin.execute(sql`update circles set demo = false, clock_at = null, timezone = 'UTC' where id = ${circle.circleId}`);
  return { circle, elena: circle.userId, marcus, daniel };
}

/** A consent for `userId`, with a fresh code and verifier the test holds as the client would. */
async function consent(userId: string, circleId: string, change: Partial<AuthorizationCodeInput> = {}) {
  const code = `kin_code_${randomBytes(32).toString("base64url")}`;
  const verifier = randomBytes(32).toString("base64url");
  const input: AuthorizationCodeInput = { circleId, codeHash: sha(code), clientId: CLIENT, clientName: "Claude Code", redirectUri: REDIRECT, codeChallenge: challengeOf(verifier), scope: "read", days: 30, resource: RESOURCE, ...change };
  await asPerson(db.app, userId, (tx) => createAuthorizationCode(tx, input));
  return { code, verifier };
}

/** The client's trade, with a fresh token whose hash Kin would keep. */
function trade(held: { code: string; verifier: string }, change: Partial<RedeemInput> = {}) {
  const token = `kin_dlg_${randomBytes(32).toString("base64url")}`;
  const input: RedeemInput = { codeHash: sha(held.code), clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: challengeOf(held.verifier), resource: RESOURCE, tokenHash: sha(token), tokenHint: token.slice(-4), ...change };
  return redeemAuthorizationCode(db.app, input).then((result) => ({ result, token }));
}

describe("an authorization code (decision 112)", () => {
  it("is traded once for a delegation for the member's own seat, labelled with the client's name, that the screen lists and resolves like any other", async () => {
    const { circle, marcus, elena } = await realCircleWithSeats();
    const held = await consent(marcus, circle.circleId, { scope: "propose", days: 7 });
    const { result, token } = await trade(held);
    expect(result).toMatchObject({ ok: true, scope: "propose" });
    if (!result.ok) throw new Error("unreachable");
    const days = (result.expiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThan(7.01);
    expect(await resolveDelegation(db.app, sha(token))).toMatchObject({ delegationId: result.delegationId, memberId: circle.members.marcus, userId: marcus, role: "contributor", scope: "propose" });
    const listed = await asPerson(db.app, elena, (tx) => readDelegations(tx, circle.circleId));
    expect(listed.find((each) => each.id === result.delegationId)).toMatchObject({ label: "Claude Code", oauthClient: CLIENT, memberId: circle.members.marcus, console: false });
    const audit = await db.admin.execute<{ origin: string; details: { oauth: boolean } }>(sql`select origin, details from audit_log where subject_id = ${result.delegationId} and action = 'delegation.granted'`);
    expect(audit.rows[0]).toMatchObject({ origin: "oauth", details: { oauth: true } });
  });

  it("accepts a trade that leaves out the redirect URI, as OAuth 2.1 allows, and refuses one that names another", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    expect((await trade(await consent(marcus, circle.circleId), { redirectUri: null })).result.ok).toBe(true);
    expect((await trade(await consent(marcus, circle.circleId), { redirectUri: "http://127.0.0.1:33418/other" })).result).toEqual({ ok: false, error: "invalid_grant" });
  });

  it("is spent by a wrong verifier, a wrong client or a wrong resource, so the right one after it fails too", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    const wrongVerifier = await consent(marcus, circle.circleId);
    expect((await trade(wrongVerifier, { codeChallenge: challengeOf("a verifier somebody guessed, of enough length to be one") })).result).toEqual({ ok: false, error: "invalid_grant" });
    expect((await trade(wrongVerifier)).result).toEqual({ ok: false, error: "invalid_grant" });
    const wrongClient = await consent(marcus, circle.circleId);
    expect((await trade(wrongClient, { clientId: "kin_cli_someone.else" })).result).toEqual({ ok: false, error: "invalid_grant" });
    expect((await trade(wrongClient)).result).toEqual({ ok: false, error: "invalid_grant" });
    expect((await trade(await consent(marcus, circle.circleId), { resource: "https://elsewhere.example/mcp" })).result).toEqual({ ok: false, error: "invalid_target" });
  });

  it("presented a second time, revokes the delegation it was traded for (OAuth 2.1 section 4.1.3)", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    const held = await consent(marcus, circle.circleId);
    const first = await trade(held);
    expect(first.result.ok).toBe(true);
    expect(await resolveDelegation(db.app, sha(first.token))).not.toBeNull();
    expect((await trade(held)).result).toEqual({ ok: false, error: "invalid_grant" });
    expect(await resolveDelegation(db.app, sha(first.token))).toBeNull();
  });

  it("expires after sixty seconds, and nobody can make one live longer", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    const held = await consent(marcus, circle.circleId);
    await db.admin.execute(sql`alter table oauth_codes disable trigger code_fixed`);
    try {
      await db.admin.execute(sql`update oauth_codes set created_at = now() - interval '2 minutes', expires_at = now() - interval '61 seconds' where code_hash = ${sha(held.code)}`);
      expect(await errorCode(db.admin.execute(sql`update oauth_codes set expires_at = created_at + interval '1 hour' where code_hash = ${sha(held.code)}`))).toBe(REFUSED.check);
    } finally {
      await db.admin.execute(sql`alter table oauth_codes enable trigger code_fixed`);
    }
    expect((await trade(held)).result).toEqual({ ok: false, error: "invalid_grant" });
    expect(await errorCode(db.admin.execute(sql`update oauth_codes set client_id = 'kin_cli_other.one' where code_hash = ${sha(held.code)}`))).toBe(REFUSED.restrict);
    expect(await errorCode(db.admin.execute(sql`delete from oauth_codes where code_hash = ${sha(held.code)}`))).not.toBe("no error");
  });

  it("is refused for an unknown or malformed code, without saying which", async () => {
    expect((await trade({ code: "kin_code_nobody", verifier: "x".repeat(43) })).result).toEqual({ ok: false, error: "invalid_grant" });
    expect(await redeemAuthorizationCode(db.app, { codeHash: "not a hash", clientId: CLIENT, redirectUri: REDIRECT, codeChallenge: "x".repeat(43), resource: RESOURCE, tokenHash: sha("t"), tokenHint: "abcd" })).toEqual({ ok: false, error: "invalid_grant" });
  });
});

describe("who may say yes", () => {
  it("refuses an observer, a demo circle, and anyone not seated in the circle", async () => {
    const { circle, daniel } = await realCircleWithSeats();
    expect(await reason(consent(daniel, circle.circleId))).toBe("refused");
    const demo = await visitorWithCircle(db);
    expect(await reason(consent(demo.userId, demo.circleId))).toBe("demo_only");
    expect(await reason(consent(demo.userId, circle.circleId))).toBe("refused");
  });

  it("keeps the five-live limit at the consent and again at the trade", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    const pending = await consent(marcus, circle.circleId);
    // The demo's sample already gave Marcus one live delegation; fill his seat to five.
    const live = await db.admin.execute<{ count: string }>(sql`select count(*) from delegations where member_id = ${circle.members.marcus} and revoked_at is null and expires_at > now()`);
    for (let each = Number(live.rows[0]?.count); each < 5; each += 1) {
      const token = `kin_dlg_${randomBytes(32).toString("base64url")}`;
      await asPerson(db.app, marcus, (tx) => grantDelegation(tx, { circleId: circle.circleId, label: `Assistant ${each}`, scope: "read", tokenHash: sha(token), tokenHint: token.slice(-4), expiresAt: new Date(Date.now() + 86_400_000), console: false }));
    }
    expect(await reason(consent(marcus, circle.circleId))).toBe("too_many");
    expect((await trade(pending)).result).toEqual({ ok: false, error: "too_many" });
  });

  it("refuses a member whose seat became an observer's between the yes and the trade", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    const held = await consent(marcus, circle.circleId);
    await db.admin.execute(sql`update members set role = 'observer' where id = ${circle.members.marcus}`);
    expect((await trade(held)).result).toEqual({ ok: false, error: "invalid_grant" });
  });
});

describe("the table of codes", () => {
  it("shows no person a row, not even their own, and no role a code's hash or challenge: only the two operations reach it", async () => {
    const { circle, marcus } = await realCircleWithSeats();
    await consent(marcus, circle.circleId);
    expect(await asPerson(db.app, marcus, (tx) => tx.execute<{ count: string }>(sql`select count(*) from oauth_codes`))).toMatchObject({ rows: [{ count: "0" }] });
    expect(await errorCode(asPerson(db.app, marcus, (tx) => tx.execute(sql`select * from oauth_codes`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select code_hash from oauth_codes`)))).toBe(REFUSED.permission);
    expect(await errorCode(asService(db.service, circle.circleId, (tx) => tx.execute(sql`select code_challenge from oauth_codes`)))).toBe(REFUSED.permission);
    expect(await asService(db.service, circle.circleId, (tx) => tx.execute<{ count: string }>(sql`select count(*) from oauth_codes`))).toMatchObject({ rows: [{ count: "1" }] });
    expect(await errorCode(db.app.execute(sql`select kin_private.issue_delegation(${circle.circleId}::uuid, ${circle.members.marcus}::uuid, 'x', 'read', ${sha("t")}, 'abcd', now() + interval '1 day', false, null)`))).toBe(REFUSED.permission);
  });
});
