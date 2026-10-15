import { appendEntries, openLedger } from "@kin/domain";
import { randomEntries, seededRandom } from "@kin/domain/testing";
import { describe, expect, it } from "vitest";

import { rekeyEntry } from "./demo/rekey.ts";
import { readAccountIds, readLedger, writeEntries } from "./ledger-store.ts";
import { asService } from "./scope.ts";
import { visitorWithCircle } from "./testing/circles.ts";
import { testDatabases } from "./testing/databases.ts";

const db = testDatabases();
const RUNS = 25;

describe("the ledger store", () => {
  it("reads back exactly the entries the money core wrote, for any ledger", async () => {
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const circle = await visitorWithCircle(db);
      const generated = randomEntries(seededRandom(seed)).map((entry) =>
        rekeyEntry(entry, { circleId: circle.circleId, members: circle.members, payees: circle.payees }),
      );
      const before = await asService(db.service, circle.circleId, (tx) => readLedger(tx, { id: circle.circleId, currency: "USD" }));
      await asService(db.service, circle.circleId, async (tx) => writeEntries(tx, generated, await readAccountIds(tx, circle.circleId)));
      const after = await asService(db.service, circle.circleId, (tx) => readLedger(tx, { id: circle.circleId, currency: "USD" }));

      const expected = appendEntries(openLedger(circle.circleId, "USD"), [...before.entries, ...generated]);
      expect({ seed, entries: after.entries }).toEqual({ seed, entries: expected.entries });
    }
  });
});
