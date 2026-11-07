import { addMember, snapshotFor, testDatabases, visitorWithCircle } from "@kin/db/testing";
import { verifyBundle } from "@kin/verify";
import { describe, expect, it } from "vitest";

import { circleBundle } from "@/content/circle/audit-bundle";
import { circleFormatters } from "@/content/circle/format";
import { circleNames } from "@/content/circle/names";
import { getDictionary } from "@/i18n/dictionary";

import { keepHead, keptHeads } from "./audit-heads";

const db = testDatabases();

async function bundleFor(userId: string, circleId: string) {
  const circle = await snapshotFor(db, userId, circleId);
  const dictionary = await getDictionary("en");
  const build = async () => circleBundle(circle, dictionary, circleNames(circle, dictionary), circleFormatters("en", circle), await keptHeads(db.app, userId, circle));
  return { circle, build };
}

describe("keeping the chain's head at each check", () => {
  it("checks the second look against the head kept at the first, and keeps each head once", async () => {
    const visitor = await visitorWithCircle(db);
    const { circle, build } = await bundleFor(visitor.userId, visitor.circleId);

    const first = await build();
    expect(verifyBundle(first).keptHeads).toEqual({ count: 0, oldest: null });
    await keepHead(db.app, visitor.userId, circle, first, "verify");
    await keepHead(db.app, visitor.userId, circle, first, "export");

    const second = await build();
    const report = verifyBundle(second);
    expect(second.heads).toEqual([{ count: first.entries.length, head: first.head, recordedAt: expect.any(String) }]);
    expect(report.keptHeads.count).toBe(1);
    expect(report.ok).toBe(true);
    // The same record stated with a different head at the same count is what a rewrite looks like: it no longer fits.
    const rewritten = { ...second, heads: second.heads.map((kept) => ({ ...kept, head: "0".repeat(64) })) };
    expect(verifyBundle(rewritten).checks.find((check) => check.id === "head")?.ok).toBe(false);
  });

  it("keeps nothing for an observer, who reads the heads and never writes one", async () => {
    const visitor = await visitorWithCircle(db);
    const observer = await addMember(db, visitor.circleId, "observer");
    const { circle, build } = await bundleFor(observer.userId, visitor.circleId);
    await keepHead(db.app, observer.userId, circle, await build(), "verify");
    expect(await keptHeads(db.app, observer.userId, circle)).toEqual([]);
  });
});
