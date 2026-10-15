import { rosesMonth } from "@kin/domain";
import { describe, expect, it } from "vitest";

import { CircleNotFoundError, readCircle } from "../read-circle.ts";
import { asPerson, asService } from "../scope.ts";
import { visitorWithCircle } from "../testing/circles.ts";
import { testDatabases } from "../testing/databases.ts";
import { PUBLIC_TABLES_SQL, countIn } from "../testing/sql.ts";

const db = testDatabases();

async function circleTables(): Promise<string[]> {
  const result = await db.admin.execute<{ tablename: string }>(PUBLIC_TABLES_SQL);
  return result.rows.map((row) => row.tablename).filter((table) => table !== "users");
}

describe("one family never sees another", () => {
  it("a person reads nothing of a circle they are not in, from any table", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const tables = await circleTables();
    await asPerson(db.app, mine.userId, async (tx) => {
      for (const table of tables) {
        expect({ table, rows: await countIn(tx, table, theirs.circleId) }).toEqual({ table, rows: 0 });
      }
    });
    // Their own circle is there in the tables any member reads.
    await asPerson(db.app, theirs.userId, async (tx) => {
      expect(await countIn(tx, "ledger_entries", theirs.circleId)).toBe(rosesMonth.ledger.entries.length);
      expect(await countIn(tx, "members", theirs.circleId)).toBe(6);
    });
  });

  it("a circle that is not theirs reads as not found, not as an empty circle", async () => {
    const [mine, theirs] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    await expect(
      asPerson(db.app, mine.userId, (tx) => readCircle(tx, { circleId: theirs.circleId, userId: mine.userId, now: new Date() })),
    ).rejects.toThrow(CircleNotFoundError);
  });

  it("without a verified person, nothing is visible at all", async () => {
    const circle = await visitorWithCircle(db);
    const tables = await circleTables();
    await db.app.transaction(async (tx) => {
      for (const table of tables) {
        expect({ table, rows: await countIn(tx, table, circle.circleId) }).toEqual({ table, rows: 0 });
      }
    });
  });

  it("Kin's service sees only the circle its job names", async () => {
    const [one, other] = await Promise.all([visitorWithCircle(db), visitorWithCircle(db)]);
    const tables = await circleTables();
    await asService(db.service, one.circleId, async (tx) => {
      for (const table of tables) {
        expect({ table, rows: await countIn(tx, table, other.circleId) }).toEqual({ table, rows: 0 });
      }
      expect(await countIn(tx, "ledger_entries", one.circleId)).toBe(rosesMonth.ledger.entries.length);
    });
  });

  it("a person's identity does not outlive their transaction on a pooled connection", async () => {
    const circle = await visitorWithCircle(db);
    await asPerson(db.app, circle.userId, async (tx) => {
      expect(await countIn(tx, "members", circle.circleId)).toBe(6);
    });
    // The pool hands out the same few connections; each new transaction starts as nobody.
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await db.app.transaction(async (tx) => {
        expect(await countIn(tx, "members", circle.circleId)).toBe(0);
      });
    }
  });
});
