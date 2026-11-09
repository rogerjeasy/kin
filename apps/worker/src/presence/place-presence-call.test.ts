import { addTrustedVoice, asPerson, asService, newCheckToken, openPresenceCheck, recordPresenceAsked } from "@kin/db";
import { adminRun, realCircle, serviceRows, testDatabases, type RealCircle } from "@kin/db/testing";
import { OutboundCallError, PRESENCE_ASK_ROUTES, fakeOutboundCaller, openPresenceAskToken } from "@kin/telephony";
import { describe, expect, it } from "vitest";

import type { InboxLog } from "../paypal-inbox/run-inbox.ts";
import { runPresenceCalls } from "./place-presence-call.ts";

const db = testDatabases();
const silent: InboxLog = () => {};
const KEY = "k".repeat(40);
const URL = "https://voice.example.com";
const ALERTS = { denied: "Denied.", unreachable: "Unreachable.", confirmed: "Confirmed.", unknown: "Unknown." };

/** A real circle's check, texted `secondsAgo` seconds ago, to a person who confirmed their number. */
async function texted(secondsAgo: number, phone = "+15555550188"): Promise<{ circle: RealCircle; checkId: string }> {
  const circle = await realCircle(db);
  const added = await asPerson(db.app, circle.userId, (tx) => addTrustedVoice(tx, { circleId: circle.circleId, name: "Theo", relationship: "grandson", phone, locale: "fr", token: newCheckToken() }));
  await adminRun(db, "update trusted_voices set confirmed_at = now() where id = $1", [added.id]);
  const { checkId } = await asPerson(db.app, circle.userId, (tx) =>
    openPresenceCheck(tx, { circleId: circle.circleId, voiceId: added.id, claimedName: "Theo", claimedRelationship: "grandson", claimedCents: 200_000, markers: [], said: ["It's Theo."], locale: "fr", token: newCheckToken(), alerts: ALERTS }),
  );
  await asService(db.service, circle.circleId, (tx) => recordPresenceAsked(tx, circle.circleId, checkId, `SM${"a".repeat(32)}`));
  await adminRun(db, "alter table presence_checks disable trigger presence_fixed");
  await adminRun(db, `update presence_checks set asked_at = now() - make_interval(secs => ${secondsAgo}) where id = $1`, [checkId]);
  await adminRun(db, "alter table presence_checks enable trigger presence_fixed");
  return { circle, checkId };
}

const deps = (caller = fakeOutboundCaller()) => ({ db: db.service, caller, publicUrl: URL, tokenKey: KEY, now: () => new Date() });

describe("Kin's call to the real person", () => {
  it("rings a person whose text went unanswered for thirty seconds, once, with addresses only the phone service can open", async () => {
    const { circle, checkId } = await texted(40);
    const caller = fakeOutboundCaller();
    expect(await runPresenceCalls(deps(caller), silent)).toBeGreaterThanOrEqual(1);
    const call = caller.placed.find((each) => each.to === "+15555550188");
    expect(call?.answerUrl.startsWith(`${URL}${PRESENCE_ASK_ROUTES.answer}?s=`)).toBe(true);
    expect(call?.statusUrl.startsWith(`${URL}${PRESENCE_ASK_ROUTES.status}?s=`)).toBe(true);
    const token = decodeURIComponent((call?.answerUrl ?? "").split("?s=")[1] ?? "");
    expect(openPresenceAskToken(token, KEY, Date.now())).toEqual({ circleId: circle.circleId, checkId, locale: "fr", reasked: 0 });
    expect(openPresenceAskToken(token, "another-key-another-key-another-key-xx", Date.now())).toBeNull();
    expect(await serviceRows(db, circle.circleId, "select ask_call_sid is not null as sid, call_attempted_at is not null as tried from presence_checks where id = $1", [checkId])).toEqual([{ sid: true, tried: true }]);
    // A second pass, or a second worker, rings nobody again.
    const again = fakeOutboundCaller();
    await runPresenceCalls(deps(again), silent);
    expect(again.placed.filter((each) => each.to === "+15555550188")).toEqual([]);
  });

  it("does not ring before thirty seconds, nor long after the family has been told", async () => {
    await texted(5, "+15555550111");
    await texted(600, "+15555550166");
    const caller = fakeOutboundCaller();
    await runPresenceCalls(deps(caller), silent);
    expect(caller.placed.filter((each) => ["+15555550111", "+15555550166"].includes(each.to))).toEqual([]);
  });

  it("never rings again when Twilio may have accepted the call, and leaves the check as it was when it refuses", async () => {
    const { circle, checkId } = await texted(40, "+15555550155");
    const caller = fakeOutboundCaller();
    caller.failNext(new OutboundCallError("network", { retryable: true, mayHaveBeenPlaced: true }));
    const logged: string[] = [];
    await runPresenceCalls(deps(caller), (line) => logged.push(JSON.stringify(line)));
    await runPresenceCalls(deps(caller), silent);
    expect(caller.placed.filter((each) => each.to === "+15555550155")).toEqual([]);
    expect(await serviceRows(db, circle.circleId, "select state, ask_call_sid from presence_checks where id = $1", [checkId])).toEqual([{ state: "asked", ask_call_sid: null }]);
    // Nothing the log says holds the number, the addresses or Twilio's own words.
    expect(logged.join("")).not.toMatch(/\+1555|voice\.example|https:/);
  });
});
