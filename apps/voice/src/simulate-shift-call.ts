import { randomUUID } from "node:crypto";

import { memoryShiftCallStore, type MemoryShiftCall, type MemoryWrite } from "./shift/memory-shift-call-store.ts";
import { TEST_AUTH_TOKEN, TEST_STATE_KEY, startService } from "./testing/start-service.ts";
import { playShiftCall, shiftCallPath, type Heard } from "./testing/shift-caller.ts";
import { spokenIn, twilioCaller } from "./testing/twilio-caller.ts";

/**
 * `pnpm --filter @kin/voice run simulate-call shift`
 *
 * Plays Kin's call to a parent about a shift against the phone service as Twilio would: every request is signed
 * with a demo auth token and carries the sealed token the worker would have put in the address. The record is an
 * in-memory stand-in for the database. It prints each TwiML answer, the sentences Kin says, and what the database
 * would have been asked to record. It needs no account, no database and no network.
 */

const CIRCLE = randomUUID();
const SHIFT = randomUUID();
const CALL_SID = `CA${"0123456789abcdef".repeat(2)}`;

type Scenario = { readonly title: string; readonly hears: readonly Heard[]; readonly answeredBy?: string };

const SCENARIOS: readonly Scenario[] = [
  { title: "A yes by keypad: she presses 1", hears: [{ digits: "1" }] },
  { title: "A yes by speech", hears: [{ speech: "Yes, she was here this morning" }] },
  { title: "A no: she presses 2", hears: [{ digits: "2" }] },
  { title: "Unclear, then a yes: Kin asks once more", hears: [{ speech: "hmm, maybe" }, { speech: "yes" }] },
  { title: "Silence twice: Kin gives up and records no word", hears: ["silence", "silence"] },
  { title: "A voicemail answers: Kin says nothing and hangs up", hears: [], answeredBy: "machine_start" },
];

const attempt: MemoryShiftCall = {
  circleId: CIRCLE,
  shiftId: SHIFT,
  attempt: 1,
  callSid: CALL_SID,
  state: "calling",
  caregiverName: "Amara",
  dayPart: "morning",
  contactName: "Elena",
};

/** What a write would do to the family's record, in words. */
function describeWrite(write: MemoryWrite): string {
  if (write.kind === "answered") return "the call is recorded as picked up";
  if (write.kind === "ended") return `the call is recorded as ended with no word (${write.status}${write.error === null ? "" : `, ${write.error}`})`;
  return write.answer === "yes"
    ? "her yes is recorded as the parent's word on this call; the shift is confirmed and its settling is queued for the worker"
    : "her no is recorded as a declined call; nothing is paid";
}

async function simulate(scenario: Scenario): Promise<void> {
  const store = memoryShiftCallStore([attempt]);
  const service = await startService({
    numbers: new Map(),
    store: { read: () => Promise.resolve(null), record: () => Promise.reject(new Error("The office line is not used")) },
    shiftCalls: store,
  });
  console.log(`\n=== ${scenario.title} ===\n`);
  const turns = await playShiftCall(twilioCaller(service.baseUrl, TEST_AUTH_TOKEN), service.baseUrl, {
    sid: CALL_SID,
    firstPath: shiftCallPath("answer", { circleId: CIRCLE, shiftId: SHIFT, attempt: 1, locale: "en", reasked: 0 }, TEST_STATE_KEY, service.now.at),
    hears: scenario.hears,
    ...(scenario.answeredBy === undefined ? {} : { answeredBy: scenario.answeredBy }),
  });
  turns.forEach((twiml, index) => {
    console.log(`--- Twilio webhook ${index + 1}: Kin answers with TwiML ---`);
    console.log(twiml.replace(/s=[^"<&]+/g, "s=<sealed token>"));
    for (const sentence of spokenIn(twiml)) console.log(`  Kin says: ${sentence}`);
    const heard = scenario.hears[index];
    if (heard !== undefined) console.log(`  She ${heard === "silence" ? "says nothing" : "digits" in heard ? `presses ${heard.digits}` : `says: ${heard.speech}`}`);
    console.log("");
  });
  console.log("--- What the database would be asked to record, as Kin's service for this one circle ---");
  if (store.writes.length === 0) console.log("  nothing");
  for (const write of store.writes) console.log(`  ${describeWrite(write)}`);
  await service.close();
}

export async function simulateShiftCalls(): Promise<void> {
  for (const scenario of SCENARIOS) await simulate(scenario);
}
