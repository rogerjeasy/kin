import { describe, expect, it } from "vitest";

import { waitForDatabase } from "./wait-for-database.ts";

/** A clock and a sleep that move together, so no test waits for real. */
function fakeTime() {
  let now = 0;
  return { now: () => now, sleep: async (ms: number) => void (now += ms) };
}

describe("waiting for a database that is resuming", () => {
  it("keeps trying until the database answers, as Aurora does after a pause", async () => {
    const time = fakeTime();
    let attempts = 0;
    const probe = async () => {
      attempts += 1;
      // Aurora took 74 seconds to resume on 15 October 2026; here it answers on the fourth try.
      if (attempts < 4) throw new Error("Connection terminated due to connection timeout");
    };
    const waited = await waitForDatabase(probe, { deadlineMs: 300_000, intervalMs: 10_000, ...time });
    expect(attempts).toBe(4);
    expect(waited).toEqual({ attempts: 4, waitedMs: 30_000 });
  });

  it("answers at once when the database is awake", async () => {
    const time = fakeTime();
    expect(await waitForDatabase(async () => undefined, { deadlineMs: 300_000, intervalMs: 10_000, ...time })).toEqual({ attempts: 1, waitedMs: 0 });
  });

  it("gives up after the deadline, with the last failure as the cause", async () => {
    const time = fakeTime();
    const last = new Error("connect ECONNREFUSED");
    const failure = waitForDatabase(async () => Promise.reject(last), { deadlineMs: 60_000, intervalMs: 10_000, ...time });
    await expect(failure).rejects.toThrow(/did not answer within 60 seconds/);
    await expect(failure).rejects.toMatchObject({ cause: last });
  });
});
