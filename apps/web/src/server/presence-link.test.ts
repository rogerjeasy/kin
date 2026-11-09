import { PresenceError, type PresenceStatus } from "@kin/db";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createRateLimiter } from "./model";
import { parseAnswer, parseConfirm, presenceAnswerResponse, presenceLinkStatus, voiceConfirmResponse, voiceLinkStatus, type PresenceLinkDeps, type VoiceLinkDeps } from "./presence-link";

const TOKEN = "A".repeat(43);
const status: PresenceStatus = { state: "asked", voiceFirstName: "Theo", parentFirstName: "Rose", claimedCents: 200_000, currency: "USD", timezone: "UTC", locale: "en", simulated: false, canAnswer: true };

function deps(overrides: Partial<PresenceLinkDeps> = {}, limit = 20): PresenceLinkDeps {
  return { read: () => Promise.resolve(status), answer: () => Promise.resolve({ state: "denied", changed: true }), limiter: createRateLimiter(limit, 60_000), now: () => 1_000, ...overrides };
}
const post = (body: unknown) => new Request("https://kin.test/api/presence-link", { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });

afterEach(() => vi.restoreAllMocks());

describe("reading an answer", () => {
  it("takes exactly a 43-character token and 'me' or 'not_me'", () => {
    expect(parseAnswer(JSON.stringify({ token: TOKEN, answer: "me" }))).toEqual({ token: TOKEN, answer: "me" });
    expect(parseAnswer(JSON.stringify({ token: TOKEN, answer: "not_me" }))).toEqual({ token: TOKEN, answer: "not_me" });
    for (const body of ["not json", "null", "[]", JSON.stringify({ token: TOKEN }), JSON.stringify({ token: "short", answer: "me" }), JSON.stringify({ token: TOKEN, answer: "yes" }), JSON.stringify({ token: TOKEN, answer: "me", extra: 1 })]) {
      expect(parseAnswer(body)).toBeNull();
    }
    expect(parseConfirm(JSON.stringify({ token: TOKEN }))).toEqual({ token: TOKEN, receiver: null });
    expect(parseConfirm(JSON.stringify({ token: TOKEN, receiver: " Theo@Personal.Example.com " }))).toEqual({ token: TOKEN, receiver: "Theo@Personal.Example.com" });
    expect(parseConfirm(JSON.stringify({ token: TOKEN, receiver: "  " }))).toEqual({ token: TOKEN, receiver: null });
    for (const body of [{ token: TOKEN, x: 1 }, { token: TOKEN, receiver: "not an email" }, { token: TOKEN, receiver: 5 }, { token: TOKEN, receiver: "a@b.c", x: 1 }, { token: "short" }]) expect(parseConfirm(JSON.stringify(body))).toBeNull();
  });
});

describe("the real person's page", () => {
  it("shows first names and the amount, never an ID or a number, and the same words for every dead link", async () => {
    const view = await presenceLinkStatus(TOKEN, new Headers(), deps());
    expect(view).toEqual({ ok: true, status: expect.objectContaining({ voiceFirstName: "Theo", parentFirstName: "Rose", claimedCents: 200_000, canAnswer: true }) });
    expect(JSON.stringify(view)).not.toMatch(/phone|circle|id"/i);
    const dead = deps({ read: () => Promise.reject(new PresenceError("refused")) });
    expect(await presenceLinkStatus(TOKEN, new Headers(), dead)).toEqual({ ok: false, reason: "link" });
    expect(await presenceLinkStatus("not-a-token", new Headers(), deps())).toEqual({ ok: false, reason: "link" });
  });

  it("answers 'no' through the database, and says the same thing for a dead link whatever is wrong with it", async () => {
    const response = await presenceAnswerResponse(post({ token: TOKEN, answer: "not_me" }), deps());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, state: "denied", changed: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    const dead = await presenceAnswerResponse(post({ token: TOKEN, answer: "me" }), deps({ answer: () => Promise.reject(new PresenceError("refused")) }));
    expect(dead.status).toBe(403);
    expect(await dead.json()).toEqual({ ok: false, reason: "link" });
    const late = await presenceAnswerResponse(post({ token: TOKEN, answer: "me" }), deps({ answer: () => Promise.reject(new PresenceError("wrong_state")) }));
    expect(late.status).toBe(409);
  });

  it("slows each address, reads at most two kilobytes, and logs a fault by its kind and never with the token", async () => {
    const slow = deps({}, 2);
    const headers = { "content-type": "application/json", "x-forwarded-for": "203.0.113.9" };
    const tap = () => presenceAnswerResponse(new Request("https://kin.test/x", { method: "POST", headers, body: JSON.stringify({ token: TOKEN, answer: "me" }) }), slow);
    expect((await tap()).status).toBe(200);
    expect((await tap()).status).toBe(200);
    expect((await tap()).status).toBe(429);
    expect((await presenceAnswerResponse(post("x".repeat(3_000)), deps())).status).toBe(400);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const broken = await presenceAnswerResponse(post({ token: TOKEN, answer: "me" }), deps({ answer: () => Promise.reject(new Error(`boom ${TOKEN}`)) }));
    expect(broken.status).toBe(503);
    expect(JSON.stringify(error.mock.calls)).not.toContain(TOKEN);
  });
});

describe("confirming a number", () => {
  const voiceDeps = (overrides: Partial<VoiceLinkDeps> = {}): VoiceLinkDeps => ({
    read: () => Promise.resolve({ name: "Theo", parentFirstName: "Rose", confirmed: false }),
    confirm: (_token, receiver) => Promise.resolve({ name: receiver ?? "Theo", parentFirstName: "Rose", confirmed: true }),
    limiter: createRateLimiter(20, 60_000),
    now: () => 1_000,
    ...overrides,
  });

  it("names the family and takes the confirmation, and answers every dead link the same way", async () => {
    expect(await voiceLinkStatus(TOKEN, new Headers(), voiceDeps())).toEqual({ ok: true, status: { name: "Theo", parentFirstName: "Rose", confirmed: false } });
    expect(await voiceLinkStatus(TOKEN, new Headers(), voiceDeps({ read: () => Promise.reject(new PresenceError("refused")) }))).toEqual({ ok: false, reason: "link" });
    const done = await voiceConfirmResponse(post({ token: TOKEN }), voiceDeps());
    expect(await done.json()).toEqual({ ok: true, name: "Theo", parentFirstName: "Rose" });
    // Their PayPal account, when they give one, reaches the database as they typed it.
    const withAccount = await voiceConfirmResponse(post({ token: TOKEN, receiver: "theo@personal.example.com" }), voiceDeps());
    expect(await withAccount.json()).toMatchObject({ name: "theo@personal.example.com" });
    expect((await voiceConfirmResponse(post({ token: "x" }), voiceDeps())).status).toBe(400);
    expect((await voiceConfirmResponse(post({ token: TOKEN }), voiceDeps({ confirm: () => Promise.reject(new PresenceError("refused")) }))).status).toBe(403);
  });
});
