import { asPerson, hashCheckToken, readCircle, useCheckLink, type CircleSnapshot } from "@kin/db";
import { seatPerson, serviceRows, visitorWithCircle, type VisitorCircle } from "@kin/db/testing";
import { TextDeliveryError, fakeTextSender, type FakeTextSender } from "@kin/notify";
import { afterEach, describe, expect, it, vi } from "vitest";

import { testDatabases } from "../../../../packages/db/src/testing/databases.ts";
import { createRateLimiter } from "./model";
import { runShift, type ShiftContext, type ShiftResult } from "./shifts";

const db = testDatabases();
const CLOCK = new Date("2026-10-30T18:00:00Z");
const ORIGIN = "https://kin.test";
const PHONE = "+14155550123";

const snapshot = (circle: VisitorCircle, userId: string): Promise<CircleSnapshot> => asPerson(db.app, userId, (tx) => readCircle(tx, { circleId: circle.circleId, userId, now: CLOCK }));

type Seen = (seen: CircleSnapshot) => CircleSnapshot;
type Options = { readonly texts?: FakeTextSender | null; readonly change?: Seen; readonly textsPerHour?: number };

/** Runs one operation as a persona of the circle, on a snapshot read just before, with a fake text sender. */
async function as(circle: VisitorCircle, persona: keyof VisitorCircle["members"], input: unknown, options: Options = {}): Promise<ShiftResult> {
  const userId = persona === "elena" ? circle.userId : await seatPerson(db, circle.circleId, circle.members[persona]);
  const seen = await snapshot(circle, userId);
  const texts = options.texts === undefined ? null : options.texts;
  const context: ShiftContext = {
    db: db.app,
    userId,
    circle: options.change ? options.change(seen) : seen,
    links: { origin: ORIGIN, texts, textLimiter: createRateLimiter(options.textsPerHour ?? 8, 3_600_000), now: () => CLOCK.getTime() },
  };
  return runShift(context, input);
}

async function todaysShift(circle: VisitorCircle): Promise<string> {
  const seen = await snapshot(circle, circle.userId);
  const found = seen.shifts.find((shift) => shift.kind === "aide" && shift.state === "scheduled" && shift.startsAt.toISOString() === "2026-10-30T14:00:00.000Z");
  if (!found) throw new Error("The demo has no aide shift today");
  return found.id;
}

const linkCount = async (circle: VisitorCircle): Promise<number> =>
  Number((await db.admin.$client.query<{ n: number }>("select count(*)::int as n from shift_check_links where circle_id = $1", [circle.circleId])).rows[0]?.n);
const linkOf = (result: ShiftResult) => {
  if (!result.ok || !("link" in result)) throw new Error(`Expected a link, got ${JSON.stringify(result)}`);
  return result.link;
};
const tokenOf = (url: string): string => new URL(url).pathname.split("/").at(-1) ?? "";

afterEach(() => vi.restoreAllMocks());

describe("who may make a check-in link, refused first", () => {
  it("refuses an observer, and a caregiver for a shift that is not theirs", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const request = { operation: "check_link", shiftId, locale: "en" };
    expect(await as(circle, "daniel", request)).toEqual({ ok: false, reason: "refused" });
    // Amara cannot even see Ana's visit, so it is not hers to link.
    const visit = (await snapshot(circle, circle.userId)).shifts.find((shift) => shift.kind === "visit");
    expect(await as(circle, "amara", { ...request, shiftId: visit?.id })).toEqual({ ok: false, reason: "refused" });
    expect(await linkCount(circle)).toBe(0);
  });

  it("lets Amara make one for her own shift, and the organizer, a contributor and the parent make one for it too", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    for (const persona of ["amara", "elena", "marcus", "rose"] as const) {
      expect(await as(circle, persona, { operation: "check_link", shiftId, locale: "en" }), persona).toMatchObject({ ok: true, link: { text: "none" } });
    }
  });

  it("reads each request strictly: a shift ID, a language Kin speaks, only those fields", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    for (const input of [
      { operation: "check_link", locale: "en" },
      { operation: "check_link", shiftId: "not-an-id", locale: "en" },
      { operation: "check_link", shiftId, locale: "xx" },
      { operation: "check_link", shiftId },
      { operation: "check_link", shiftId, locale: "en", extra: true },
      { operation: "check_link", shiftId, locale: "en", phone: 14155550123 },
    ]) {
      expect(await as(circle, "elena", input), JSON.stringify(input)).toEqual({ ok: false, reason: "invalid" });
    }
  });
});

describe("making a check-in link", () => {
  it("shows the address once and stores only its hash, and the link works with nobody signed in", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const link = linkOf(await as(circle, "elena", { operation: "check_link", shiftId, locale: "fr" }));
    const token = tokenOf(link.url);

    expect(link.url).toBe(`${ORIGIN}/fr/c/${token}`);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(link.qr.size).toBeGreaterThan(20);
    // A link lives until six hours past the shift's planned end, and no longer.
    const planned = (await snapshot(circle, circle.userId)).shifts.find((shift) => shift.id === shiftId);
    expect(link.expiresAt).toBe(new Date((planned?.endsAt.getTime() ?? 0) + 6 * 3_600_000).toISOString());
    // Not even Kin's worker may read the links table: the admin role looks.
    const { rows } = await db.admin.$client.query<{ token_hash: string }>("select token_hash from shift_check_links where shift_id = $1", [shiftId]);
    expect(rows).toEqual([{ token_hash: hashCheckToken(token) }]);
    expect(JSON.stringify(rows)).not.toContain(token);

    const tapped = await useCheckLink(db.app, { token, action: "in" });
    expect(tapped).toMatchObject({ shiftId, turned: true, memberFirstName: "Amara" });
  });

  it("refuses a shift that has moved on, and a sixth live link", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    for (let each = 0; each < 5; each += 1) linkOf(await as(circle, "elena", { operation: "check_link", shiftId, locale: "en" }));
    expect(await as(circle, "elena", { operation: "check_link", shiftId, locale: "en" })).toEqual({ ok: false, reason: "too_many_links" });

    const other = await visitorWithCircle(db);
    const closed = await todaysShift(other);
    await as(other, "amara", { operation: "check_in", shiftId: closed });
    await as(other, "amara", { operation: "check_out", shiftId: closed });
    expect(await as(other, "elena", { operation: "check_link", shiftId: closed, locale: "en" })).toEqual({ ok: false, reason: "wrong_state" });
  });
});

describe("texting a check-in link", () => {
  it("sends the text Kin words, to the number typed, and keeps and returns nothing of the number", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const texts = fakeTextSender();
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const result = await as(circle, "elena", { operation: "check_link", shiftId, locale: "en", phone: "+1 (415) 555-0123" }, { texts });
    const link = linkOf(result);

    expect(link.text).toBe("sent");
    expect(texts.sent).toHaveLength(1);
    expect(texts.sent[0]?.to).toBe(PHONE);
    expect(texts.sent[0]?.body).toContain(link.url);
    expect(texts.sent[0]?.body).toContain("Amara");
    expect(JSON.stringify(result)).not.toContain("4155550123");
    expect(JSON.stringify(logged.mock.calls)).not.toContain("4155550123");
    // Nothing in the database holds the number: the link rows have no such column and the audit says nothing of it.
    const audit = await serviceRows(db, circle.circleId, "select details::text as details from audit_log where circle_id = $1 and action = 'shift.link_minted'", [circle.circleId]);
    expect(JSON.stringify(audit)).not.toContain("4155550123");
  });

  it("says texting is off, refuses a number that is not one, and limits how many texts a person sends", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const text = (phone: string) => ({ operation: "check_link", shiftId, locale: "en", phone });
    expect(await as(circle, "elena", text(PHONE), { texts: null })).toEqual({ ok: false, reason: "texting_off" });
    const texts = fakeTextSender();
    for (const phone of ["", "415 555 0123", "+0123456789", "+1", "+141555501234567890"]) {
      expect(await as(circle, "elena", text(phone), { texts }), phone).toEqual({ ok: false, reason: "bad_phone" });
    }
    expect(texts.sent).toHaveLength(0);
    expect(await as(circle, "elena", text(PHONE), { texts, textsPerHour: 0 })).toEqual({ ok: false, reason: "text_limit" });
    // Nothing was made for any of these refusals.
    expect(await linkCount(circle)).toBe(0);
  });

  it("still returns the link when the text could not be sent, so it can be copied", async () => {
    const circle = await visitorWithCircle(db);
    const shiftId = await todaysShift(circle);
    const texts = fakeTextSender();
    texts.failNext(new TextDeliveryError("unavailable", { retryable: true, mayHaveBeenSent: false }));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const link = linkOf(await as(circle, "elena", { operation: "check_link", shiftId, locale: "en", phone: PHONE }, { texts }));
    expect(link.text).toBe("failed");
    expect(link.url).toContain("/c/");
    expect(JSON.stringify(logged.mock.calls)).not.toContain(PHONE);
    expect(JSON.stringify(logged.mock.calls)).not.toContain(tokenOf(link.url));
  });
});
