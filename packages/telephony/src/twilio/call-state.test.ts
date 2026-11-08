import { describe, expect, it } from "vitest";

import { CALL_STATE_TTL_MS, openCallState, sealCallState, type CallState } from "./call-state.ts";
import { openToken, sealToken } from "./sealed-token.ts";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000_000;
const STATE: CallState = {
  sid: `CA${"a".repeat(32)}`,
  circle: "0b6f7a53-0c5b-4a3f-8d2e-6a1b2c3d4e5f",
  locale: "fr",
  from: "+15555550199",
  heard: ["Mike", "Harbor Gas"],
  silent: 1,
};

describe("sealed tokens", () => {
  it("come back whole to the key that sealed them", () => {
    expect(openToken(sealToken({ a: 1 }, KEY), KEY)).toEqual({ a: 1 });
  });

  it("refuse another key, an edited body, an edited tag and a malformed token", () => {
    const token = sealToken({ a: 1 }, KEY);
    const [body = "", tag = ""] = token.split(".");
    const edited = Buffer.from(JSON.stringify({ a: 2 })).toString("base64url");
    expect(openToken(token, "z".repeat(40))).toBeNull();
    expect(openToken(`${edited}.${tag}`, KEY)).toBeNull();
    expect(openToken(`${body}.${tag.slice(0, -2)}AA`, KEY)).toBeNull();
    for (const bad of ["", "x", "a.b.c", `${body}.`]) expect(openToken(bad, KEY)).toBeNull();
  });
});

describe("the state of a call between turns", () => {
  it("is restored exactly while it is fresh", () => {
    expect(openCallState(sealCallState(STATE, KEY, NOW), KEY, NOW + 1000)).toEqual(STATE);
  });

  it("expires, so an old token cannot be replayed into a new call", () => {
    const token = sealCallState(STATE, KEY, NOW);
    expect(openCallState(token, KEY, NOW + CALL_STATE_TTL_MS + 1)).toBeNull();
  });

  it("is refused under another key", () => {
    expect(openCallState(sealCallState(STATE, KEY, NOW), "z".repeat(40), NOW)).toBeNull();
  });

  it("is refused when sealed with a valid key but a shape the service never makes", () => {
    const exp = NOW + 1000;
    const bad: unknown[] = [
      { ...STATE, exp, sid: "CA123" },
      { ...STATE, exp, circle: "not-a-uuid" },
      { ...STATE, exp, locale: "xx" },
      { ...STATE, exp, from: "<script>" },
      { ...STATE, exp, heard: ["a", "b", "c", "d", "e", "f"] },
      { ...STATE, exp, heard: [""] },
      { ...STATE, exp, heard: ["x".repeat(201)] },
      { ...STATE, exp, silent: -1 },
      { ...STATE, exp, silent: 1.5 },
      { ...STATE, exp, silent: 12, heard: ["a"] },
      { ...STATE, exp: "soon" },
      null,
      [],
    ];
    for (const payload of bad) expect(openCallState(sealToken(payload, KEY), KEY, NOW)).toBeNull();
  });
});
