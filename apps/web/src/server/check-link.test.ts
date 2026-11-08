import { ShiftError, type CheckLinkResult, type CheckLinkStatus } from "@kin/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CHECK_TOKEN, checkLinkResponse, checkLinkStatus, clientKey, parseTap, type CheckLinkDeps, type CheckLinkStatusDeps } from "./check-link";
import { createRateLimiter } from "./model";

const TOKEN = "A".repeat(43);
const SECRET = "SECRET".padEnd(43, "x");

const result: CheckLinkResult = {
  shiftId: "11111111-1111-4111-8111-111111111111",
  circleId: "22222222-2222-4222-8222-222222222222",
  kind: "aide",
  state: "checked_in",
  startsAt: new Date("2026-10-30T14:00:00Z"),
  endsAt: new Date("2026-10-30T20:00:00Z"),
  checkedInAt: new Date("2026-10-30T14:03:00Z"),
  checkedOutAt: null,
  memberFirstName: "Amara",
  timezone: "America/New_York",
  familyWordIn: false,
  action: "in",
  turned: true,
};

function deps(tap: CheckLinkDeps["tap"], limit = 20): CheckLinkDeps {
  return { tap, limiter: createRateLimiter(limit, 60_000), now: () => 1_000 };
}

function post(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("https://kin.test/api/check-link", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });
}

afterEach(() => vi.restoreAllMocks());

describe("reading a tap", () => {
  it("takes exactly a 43-character token and in or out, and nothing else", () => {
    expect(parseTap(JSON.stringify({ token: TOKEN, action: "in" }))).toEqual({ token: TOKEN, action: "in" });
    expect(parseTap(JSON.stringify({ token: TOKEN, action: "out" }))).toEqual({ token: TOKEN, action: "out" });
    for (const body of [
      "",
      "not json",
      "[]",
      "null",
      JSON.stringify({ token: TOKEN }),
      JSON.stringify({ token: TOKEN, action: "sideways" }),
      JSON.stringify({ token: "short", action: "in" }),
      JSON.stringify({ token: `${TOKEN}A`, action: "in" }),
      JSON.stringify({ token: `${"A".repeat(42)}!`, action: "in" }),
      JSON.stringify({ token: TOKEN, action: "in", extra: 1 }),
      JSON.stringify({ token: 5, action: "in" }),
    ]) {
      expect(parseTap(body), body).toBeNull();
    }
    expect(CHECK_TOKEN.test(TOKEN)).toBe(true);
  });

  it("keys the limit on the address the load balancer saw, the last one in the list", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientKey(new Headers())).toBe("unknown");
  });
});

describe("the public check-in route", () => {
  it("answers a tap with the first name and times, and no ID, and says never to cache or pass on the page", async () => {
    const tap = vi.fn(() => Promise.resolve(result));
    const response = await checkLinkResponse(post({ token: TOKEN, action: "in" }), deps(tap));
    const body = (await response.json()) as unknown;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(tap).toHaveBeenCalledWith({ token: TOKEN, action: "in" });
    expect(body).toEqual({
      ok: true,
      check: { action: "in", turned: true, name: "Amara", timezone: "America/New_York", startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T20:00:00.000Z", checkedInAt: "2026-10-30T14:03:00.000Z", checkedOutAt: null },
    });
    expect(JSON.stringify(body)).not.toContain(result.shiftId);
    expect(JSON.stringify(body)).not.toContain(result.circleId);
  });

  it("says the same thing, with the same status, to a body that is not a tap and to a token the database refuses", async () => {
    const tap = vi.fn(() => Promise.reject(new ShiftError("refused")));
    const refused = await checkLinkResponse(post({ token: SECRET, action: "in" }), deps(tap));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ ok: false, reason: "link" });
    for (const body of ["garbage", { token: "x", action: "in" }, { token: TOKEN, action: "in", more: 1 }]) {
      const malformed = await checkLinkResponse(post(body), deps(tap));
      expect(await malformed.json(), JSON.stringify(body)).toEqual({ ok: false, reason: "link" });
      expect(malformed.status).toBe(400);
    }
  });

  it.each([
    ["not_started", "early"],
    ["wrong_state", "state"],
    ["visit_too_short", "short"],
  ] as const)("words a real link's %s as %s", async (reason, word) => {
    const response = await checkLinkResponse(post({ token: TOKEN, action: "out" }), deps(() => Promise.reject(new ShiftError(reason))));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ ok: false, reason: word });
  });

  it("reads at most two kilobytes", async () => {
    const tap = vi.fn(() => Promise.resolve(result));
    const response = await checkLinkResponse(post(`{"token":"${TOKEN}","action":"in","pad":"${"x".repeat(3_000)}"}`), deps(tap));
    expect(response.status).toBe(400);
    expect(tap).not.toHaveBeenCalled();
  });

  it("slows one address to twenty taps a minute and leaves another alone", async () => {
    const tap = vi.fn(() => Promise.reject(new ShiftError("refused")));
    const limited = deps(tap, 3);
    const from = (address: string) => checkLinkResponse(post({ token: TOKEN, action: "in" }, { "x-forwarded-for": address }), limited);
    expect([(await from("1.1.1.1")).status, (await from("1.1.1.1")).status, (await from("1.1.1.1")).status]).toEqual([403, 403, 403]);
    const slowed = await from("1.1.1.1");
    expect(slowed.status).toBe(429);
    expect(await slowed.json()).toEqual({ ok: false, reason: "busy" });
    expect((await from("2.2.2.2")).status).toBe(403);
    // The database was never asked for the slowed tap.
    expect(tap).toHaveBeenCalledTimes(4);
  });

  it("counts a tap against the limit even when it was malformed, so guessing is slowed too", async () => {
    const tap = vi.fn(() => Promise.resolve(result));
    const limited = deps(tap, 2);
    await checkLinkResponse(post("garbage"), limited);
    await checkLinkResponse(post("garbage"), limited);
    expect((await checkLinkResponse(post({ token: TOKEN, action: "in" }), limited)).status).toBe(429);
  });

  it("says unavailable for a fault, and logs the kind of fault and never the token", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await checkLinkResponse(post({ token: SECRET, action: "in" }), deps(() => Promise.reject(new Error(`connection lost near ${SECRET}`))));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "unavailable" });
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
    expect(JSON.stringify(logged.mock.calls)).toContain("check_link.unavailable");
  });
});

describe("the public page's first look at a link", () => {
  const status: CheckLinkStatus = {
    kind: "aide",
    state: "scheduled",
    startsAt: new Date("2026-10-30T14:00:00Z"),
    endsAt: new Date("2026-10-30T20:00:00Z"),
    memberFirstName: "Amara",
    timezone: "America/New_York",
    familyWordIn: true,
    next: "in",
  };
  const looking = (read: CheckLinkStatusDeps["read"], limit = 20): CheckLinkStatusDeps => ({ read, limiter: createRateLimiter(limit, 60_000), now: () => 1_000 });
  const from = (address = "203.0.113.9") => new Headers({ "x-forwarded-for": address });

  it("tells the first name, the times, the circle's zone and the one key, and nothing the page does not need", async () => {
    const read = vi.fn(() => Promise.resolve(status));
    const view = await checkLinkStatus(TOKEN, from(), looking(read));
    expect(read).toHaveBeenCalledWith({ token: TOKEN });
    expect(view).toEqual({ ok: true, status: { name: "Amara", timezone: "America/New_York", startsAt: "2026-10-30T14:00:00.000Z", endsAt: "2026-10-30T20:00:00.000Z", next: "in" } });
    // Not the kind, the state or whether the family has spoken: the page offers a key and a time.
    expect(JSON.stringify(view)).not.toMatch(/aide|scheduled|familyWordIn/);
  });

  it("gives every token the database will not show the one reason, and never asks it about a token that cannot be one", async () => {
    const read = vi.fn(() => Promise.reject(new ShiftError("refused")));
    expect(await checkLinkStatus(SECRET, from(), looking(read))).toEqual({ ok: false, reason: "link" });
    for (const token of ["", "short", `${TOKEN}A`, `${"A".repeat(42)}!`]) {
      expect(await checkLinkStatus(token, from(), looking(read)), token).toEqual({ ok: false, reason: "link" });
    }
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("counts each look against the address, in the very bucket the taps use, and does not ask the database once slowed", async () => {
    const read = vi.fn(() => Promise.resolve(status));
    const shared = looking(read, 3);
    expect((await checkLinkStatus(TOKEN, from("1.1.1.1"), shared)).ok).toBe(true);
    expect((await checkLinkStatus("short", from("1.1.1.1"), shared)).ok).toBe(false);
    // A tap from the same address draws on what the looks used.
    const tap = vi.fn(() => Promise.resolve(result));
    expect((await checkLinkResponse(post({ token: TOKEN, action: "in" }, { "x-forwarded-for": "1.1.1.1" }), { tap, limiter: shared.limiter, now: shared.now })).status).toBe(200);
    expect(await checkLinkStatus(TOKEN, from("1.1.1.1"), shared)).toEqual({ ok: false, reason: "busy" });
    expect(read).toHaveBeenCalledTimes(1);
    expect((await checkLinkStatus(TOKEN, from("2.2.2.2"), shared)).ok).toBe(true);
  });

  it("says unavailable for a fault, and logs the kind of fault and never the token", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const view = await checkLinkStatus(SECRET, from(), looking(() => Promise.reject(new Error(`connection lost near ${SECRET}`))));
    expect(view).toEqual({ ok: false, reason: "unavailable" });
    expect(logged).toHaveBeenCalledOnce();
    expect(JSON.stringify(logged.mock.calls)).not.toContain(SECRET);
  });
});
