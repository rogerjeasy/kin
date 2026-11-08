import { describe, expect, it } from "vitest";

import { sealToken } from "../twilio/sealed-token.ts";
import { sealCallState } from "../twilio/call-state.ts";
import { SHIFT_CALL_TOKEN_TTL_MS, openShiftCallToken, sealShiftCallToken, shiftCallUrl, type ShiftCallToken } from "./shift-call-token.ts";

const KEY = "k".repeat(40);
const NOW = 1_800_000_000_000;
const TOKEN: ShiftCallToken = {
  circleId: "0b6f7a53-0c5b-4a3f-8d2e-6a1b2c3d4e5f",
  shiftId: "7c1d9e2a-3b4c-4d5e-8f6a-1b2c3d4e5f60",
  attempt: 1,
  locale: "ar",
  reasked: 0,
};

describe("the sealed state of a shift call", () => {
  it("comes back exactly while it is fresh", () => {
    expect(openShiftCallToken(sealShiftCallToken(TOKEN, KEY, NOW), KEY, NOW + 1000)).toEqual(TOKEN);
  });

  it("expires, so an old address cannot be replayed into a new call", () => {
    const sealed = sealShiftCallToken(TOKEN, KEY, NOW);
    expect(openShiftCallToken(sealed, KEY, NOW + SHIFT_CALL_TOKEN_TTL_MS - 1)).toEqual(TOKEN);
    expect(openShiftCallToken(sealed, KEY, NOW + SHIFT_CALL_TOKEN_TTL_MS)).toBeNull();
  });

  it("is refused under another key, when edited and when malformed", () => {
    const sealed = sealShiftCallToken(TOKEN, KEY, NOW);
    const [body = "", tag = ""] = sealed.split(".");
    const edited = Buffer.from(JSON.stringify({ ...TOKEN, kind: "shift_call", shiftId: "00000000-0000-4000-8000-000000000000", exp: NOW + 1000 })).toString("base64url");
    expect(openShiftCallToken(sealed, "z".repeat(40), NOW)).toBeNull();
    expect(openShiftCallToken(`${edited}.${tag}`, KEY, NOW)).toBeNull();
    expect(openShiftCallToken(`${body}.`, KEY, NOW)).toBeNull();
    for (const bad of ["", "x", "a.b.c"]) expect(openShiftCallToken(bad, KEY, NOW)).toBeNull();
  });

  it("is refused when sealed with the right key but a shape the service never makes", () => {
    const exp = NOW + 1000;
    const good = { kind: "shift_call", ...TOKEN, exp };
    const bad: unknown[] = [
      { ...good, kind: "call_state" },
      { ...good, kind: undefined },
      { ...good, circleId: "nope" },
      { ...good, shiftId: 7 },
      { ...good, attempt: 0 },
      { ...good, attempt: 1.5 },
      { ...good, attempt: 11 },
      { ...good, locale: "xx" },
      { ...good, reasked: 2 },
      { ...good, reasked: -1 },
      { ...good, exp: "soon" },
      null,
      [],
    ];
    for (const payload of bad) expect(openShiftCallToken(sealToken(payload, KEY), KEY, NOW), JSON.stringify(payload)).toBeNull();
    expect(openShiftCallToken(sealToken(good, KEY), KEY, NOW)).toEqual(TOKEN);
  });

  it("is not accepted from the office line's call state, and the office line does not accept it", () => {
    const office = sealCallState(
      { sid: `CA${"a".repeat(32)}`, circle: TOKEN.circleId, locale: "en", from: null, heard: [], silent: 0 },
      KEY,
      NOW,
    );
    expect(openShiftCallToken(office, KEY, NOW)).toBeNull();
  });

  it("holds identifiers only: no name, number or amount reaches Twilio in the address", () => {
    const [body = ""] = sealShiftCallToken(TOKEN, KEY, NOW).split(".");
    expect(Object.keys(JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as object).toSorted()).toEqual(
      ["attempt", "circleId", "exp", "kind", "locale", "reasked", "shiftId"],
    );
  });
});

describe("the address of a route", () => {
  it("joins the public base and the route, with the token encoded as one query value", () => {
    const url = shiftCallUrl("https://voice.example.com/", "answer", "abc.def_-");
    expect(url).toBe("https://voice.example.com/voice/shift/answer?s=abc.def_-");
    expect(shiftCallUrl("https://voice.example.com", "status", "a b&c")).toBe("https://voice.example.com/voice/shift/status?s=a%20b%26c");
  });
});
