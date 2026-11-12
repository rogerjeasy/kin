import { readPayPalConfig, readSandboxPayoutConfig } from "@kin/config";
import { asPerson, answerProposal, configureCaregiver, sendCaregiverBill, submitCaregiverBill, takeDemoSeat } from "@kin/db";
import { agreeAtRate, seatPerson, serviceRows, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { payoutFeeReserve, poolFor } from "@kin/paypal";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { executePayout } from "./execute-payout.ts";
import { dailyBudget } from "./sandbox-route.ts";

/**
 * One real payout through PayPal's sandbox, by the worker's own code, from a
 * throwaway demo circle. Off unless asked for, since it spends sandbox money:
 * `KIN_SANDBOX_LIVE=on` with the pool's `KIN_PAYPAL_*` settings and
 * `KIN_DEMO_SANDBOX_PAYEE_EMAIL` (Kin's sandbox personal account) set.
 */
const live = process.env["KIN_SANDBOX_LIVE"] === "on";
const db = testDatabases();
const POLL_MS = 5_000;
const POLLS = 24;

describe.runIf(live)("a demo caregiver payout through the real PayPal sandbox", () => {
  it("is sent to Kin's sandbox account and confirmed only once PayPal's record says SUCCESS", async () => {
    const paypal = readPayPalConfig(process.env, { webhook: false });
    const sandbox = readSandboxPayoutConfig(process.env);
    if (!paypal.enabled || !sandbox.enabled) throw new Error("Set KIN_PAYPAL_CLIENT_ID, KIN_PAYPAL_CLIENT_SECRET and KIN_DEMO_SANDBOX_PAYEE_EMAIL");

    const circle = await visitorWithCircle(db);
    const caregiver = await seatPerson(db, circle.circleId, circle.members.amara);
    // Half an hour at 10.00: a 5.00 payout.
    await asPerson(db.app, circle.userId, (tx) => configureCaregiver(tx, { circleId: circle.circleId, memberId: circle.members.amara, payeeId: circle.payees.amara, name: "Amara", rateCentsPerHour: 1000 }));
    // Kin pays only at the rate a signed care agreement states.
    await agreeAtRate(db, circle.circleId, circle.payees.amara, 1000);
    const billId = await asPerson(db.app, caregiver, (tx) =>
      submitCaregiverBill(tx, { circleId: circle.circleId, details: { version: 1, currency: "USD", rateCentsPerHour: 1000, visits: [{ date: "2026-10-20", minutes: 30 }] }, submissionKey: randomUUID() }),
    );
    // A demo circle runs on its own clock.
    const now = new Date(String((await serviceRows(db, circle.circleId, "select clock_at from circles where id = $1", [circle.circleId]))[0]?.clock_at));
    const proposalId = await asPerson(db.app, circle.userId, (tx) => sendCaregiverBill(tx, { circleId: circle.circleId, billId, now }));
    // A visitor's typed address, which must never be paid.
    await serviceRows(db, circle.circleId, "update payees set paypal_receiver = $1 where id = $2", ["visitor-typed@example.com", circle.payees.amara]);
    // The approval engine decides, on the family's recorded yeses.
    let decision = "pending";
    for (const [member, role] of [[circle.members.rose, "parent"], [circle.members.elena, "organizer"], [circle.members.marcus, "contributor"]] as const) {
      if (decision === "approved") break;
      await asPerson(db.app, circle.userId, (tx) => takeDemoSeat(tx, circle.circleId, member));
      decision = await asPerson(db.app, circle.userId, (tx) =>
        answerProposal(tx, { circleId: circle.circleId, memberId: member, role }, { proposalId, decision: "approve", method: "app", now, pausedUntil: null, evidenceRef: null }),
      );
    }
    expect(decision).toBe("approved");
    const executionId = String((await serviceRows(db, circle.circleId, "select id from executions where proposal_id = $1", [proposalId]))[0]?.id);

    const deps = {
      db: db.service,
      pool: poolFor(paypal),
      now: () => new Date(),
      feeReserve: (currency: string) => payoutFeeReserve(currency)(),
      sandbox: { payeeEmail: sandbox.payeeEmail, dailyLimit: sandbox.dailyLimit, budget: dailyBudget() },
    };
    const steps: string[] = [];
    for (let poll = 0; poll < POLLS; poll += 1) {
      const step = await executePayout(deps, circle.circleId, executionId);
      steps.push(step.result);
      if (step.next === "done") break;
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    const [row] = await serviceRows(db, circle.circleId, "select state, paypal_batch_id, paypal_item_id, last_error from executions where id = $1", [executionId]);
    const batch = typeof row?.paypal_batch_id === "string" ? await deps.pool.getPayoutBatch(row.paypal_batch_id) : null;
    // Ids and statuses only: never an address or a credential.
    const report = JSON.stringify({ steps, execution: row, batchStatus: batch?.batchStatus, item: batch?.items[0] && { itemId: batch.items[0].itemId, status: batch.items[0].status, transactionId: batch.items[0].transactionId, fee: batch.items[0].fee } });
    // Vitest keeps a passing test quiet: the report goes to a file when one is named.
    const reportFile = process.env["KIN_SANDBOX_LIVE_REPORT"];
    if (reportFile) writeFileSync(reportFile, report);
    console.log(report);
    expect(steps.at(-1)).toBe("confirmed");
    expect(row?.paypal_batch_id).toEqual(expect.any(String));
    expect(batch?.items[0]?.status).toBe("SUCCESS");
  }, 180_000);
});
