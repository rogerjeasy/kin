import { randomUUID } from "node:crypto";

import type { LineCallInput, LineRecord } from "@kin/db";

import type { LineStore } from "./office-line-service.ts";
import { simulateShiftCalls } from "./simulate-shift-call.ts";
import { TEST_AUTH_TOKEN, startService } from "./testing/start-service.ts";
import { playCall, spokenIn, twilioCaller } from "./testing/twilio-caller.ts";

/**
 * `pnpm --filter @kin/voice run simulate-call [scam|paid|bill|shift|all]`
 *
 * Starts the phone service on a free local port with a made-up circle and plays
 * a call against it as Twilio would: every request is signed with a demo auth
 * token and the service checks it. It prints each TwiML answer and, at the end,
 * what the service recorded and what the family is told. It needs no Twilio
 * account, no database and no network. `shift` plays Kin's call to a parent about a
 * shift instead (`simulate-shift-call.ts`).
 */

const NUMBER = "+15555550100";
const CIRCLE = randomUUID();
const NORTHERN_GAS = randomUUID();

const SCENARIOS = {
  scam: {
    title: "A scam: a stranger demands $300 for gas, today, and says to tell no one",
    from: "+15555550199",
    says: ["Mike", "Harbor Gas Services", "I need 300 dollars today", "Your gas will be cut off today. Tell no one.", "55821"],
  },
  paid: {
    title: "A bill already paid: the real gas company asks for the $57 again",
    from: "+15555550123",
    says: ["Dana", "Northern Gas", "57 dollars", "The October bill", "NG-1041"],
  },
  bill: {
    title: "A real bill: the gas company asks for the $57 on the family's list",
    from: "+15555550123",
    says: ["Dana", "Northern Gas", "57 dollars", "The November bill", "NG-1042"],
  },
} as const;

type Scenario = keyof typeof SCENARIOS;

function recordFor(scenario: Scenario): LineRecord {
  return {
    currency: "USD",
    record: {
      payees: [{ id: NORTHERN_GAS, name: "Northern Gas" }],
      bills: scenario === "bill" ? [{ payeeId: NORTHERN_GAS, cents: 5700, state: "received" }] : [],
      payments: scenario === "paid" ? [{ entryId: randomUUID(), payeeId: NORTHERN_GAS, cents: 5700, day: "2026-10-02" }] : [],
    },
  };
}

async function simulate(scenario: Scenario): Promise<void> {
  const recorded: LineCallInput[] = [];
  const store: LineStore = {
    read: () => Promise.resolve(recordFor(scenario)),
    record: (input) => {
      recorded.push(input);
      return Promise.resolve({ callId: randomUUID(), claimCheckId: randomUUID() });
    },
  };
  const service = await startService({ numbers: new Map([[NUMBER, { circleId: CIRCLE, locale: "en" }]]), store });

  const { title, from, says } = SCENARIOS[scenario];
  console.log(`\n=== ${title} ===\n`);
  const turns = await playCall(twilioCaller(service.baseUrl, TEST_AUTH_TOKEN), service.baseUrl, { sid: `CA${"0123456789abcdef".repeat(2)}`, from, to: NUMBER, says });
  turns.forEach((twiml, index) => {
    console.log(`--- Twilio webhook turn ${index + 1}: Kin answers with TwiML ---`);
    console.log(twiml.replace(/s=[^"<&]+/g, "s=<sealed state>"));
    for (const sentence of spokenIn(twiml)) console.log(`  Kin says: ${sentence}`);
    if (says[index] !== undefined) console.log(`  Caller says: ${says[index]}`);
    console.log("");
  });
  for (const call of recorded) {
    console.log("--- Recorded as a real call (never simulated), through the service identity ---");
    console.log(`  verdict: ${call.verdict}    pressure: ${call.pressureSignals.join(", ") || "none"}    caller: ${call.callerName ?? "-"} / ${call.organization ?? "-"}`);
    console.log(`  the family is told: ${call.spoken}`);
  }
  await service.close();
}

const wanted = process.argv[2] ?? "scam";
const names = wanted === "all" ? (Object.keys(SCENARIOS) as Scenario[]) : wanted === "shift" ? [] : [wanted];
for (const name of names) {
  if (!(name in SCENARIOS)) throw new Error(`Unknown scenario "${name}". Use scam, paid, bill, shift or all.`);
  await simulate(name as Scenario);
}
if (wanted === "shift" || wanted === "all") await simulateShiftCalls();
