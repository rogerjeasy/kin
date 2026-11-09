import { MAX_OFFER_CENTS, SPREAD_MONTHS, mediateQuietShare, type MediationInput, type SealedOffer } from "@kin/domain";
import { forAll, type Random } from "@kin/domain/testing";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { QUIET_SHARE_ASK } from "./demo/roses-circle.ts";
import {
  QuietShareError,
  acceptMyQuietSharePart,
  raiseQuietShare,
  readQuietShares,
  sealMyOffer,
  spreadQuietShare,
  takeQuietShareGap,
  withdrawQuietShare,
  type OfferTerms,
  type QuietShareRecord,
} from "./quiet-shares.ts";
import { asPerson } from "./scope.ts";
import { seatPerson, visitorWithCircle, type VisitorCircle } from "./testing/index.ts";
import { testDatabases } from "./testing/databases.ts";

const db = testDatabases();

const offer = (monthlyCents: number, change: Partial<OfferTerms> = {}): OfferTerms => ({ monthlyCents, stepUp: null, careTrips: 0, careMinutes: 0, earliestMonth: null, ...change });
const reason = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
    return "no error";
  } catch (error) {
    return error instanceof QuietShareError ? error.reason : `uncoded: ${String(error)}`;
  }
};

type Family = { readonly circle: VisitorCircle; readonly elena: string; readonly marcus: string; readonly ana: string };

async function family(): Promise<Family> {
  const circle = await visitorWithCircle(db);
  const [marcus, ana] = await Promise.all([seatPerson(db, circle.circleId, circle.members.marcus), seatPerson(db, circle.circleId, circle.members.ana)]);
  return { circle, elena: circle.userId, marcus: marcus, ana: ana };
}

const memberOf = (people: Family, userId: string): string =>
  userId === people.elena ? people.circle.members.elena : userId === people.marcus ? people.circle.members.marcus : people.circle.members.ana;

async function asks(people: Family, userId: string): Promise<QuietShareRecord[]> {
  return asPerson(db.app, userId, (tx) => readQuietShares(tx, { circleId: people.circle.circleId, memberId: memberOf(people, userId) }));
}

async function stairlift(people: Family, userId: string): Promise<QuietShareRecord> {
  const ask = (await asks(people, userId)).find((each) => each.title === QUIET_SHARE_ASK.title);
  if (!ask) throw new Error("No stairlift ask");
  return ask;
}

const seal = (people: Family, userId: string, askId: string, terms: OfferTerms) => asPerson(db.app, userId, (tx) => sealMyOffer(tx, { circleId: people.circle.circleId, askId, offer: terms }));
const accept = (people: Family, userId: string, askId: string, method: "checkout" | "pay_later" | "invoice" | "monthly_share") =>
  asPerson(db.app, userId, (tx) => acceptMyQuietSharePart(tx, { circleId: people.circle.circleId, askId, method }));

describe("the demo's stairlift, asked with quiet shares", () => {
  it("waits for Marcus and Ana with Elena's offer sealed, and lands as Marcus 540, Elena 300 and Ana 60 with her drives", async () => {
    const people = await family();
    const waiting = await stairlift(people, people.elena);
    expect(waiting).toMatchObject({ state: "gathering", costCents: 90_000, askedCount: 3, answeredCount: 1, iAmAsked: true, simulated: true, myPart: null });
    expect(waiting.myOffer).toMatchObject({ monthlyCents: 30_000, seals: 1 });
    expect((await stairlift(people, people.marcus)).myOffer).toBeNull();

    expect(await seal(people, people.marcus, waiting.id, offer(60_000))).toBe("gathering");
    expect((await stairlift(people, people.ana)).answeredCount).toBe(2);
    expect(await seal(people, people.ana, waiting.id, offer(6_000, { careTrips: 2, careMinutes: 180 }))).toBe("planned");

    const [elena, marcus, ana] = await Promise.all([people.elena, people.marcus, people.ana].map((userId) => stairlift(people, userId)));
    expect(elena?.myPart).toMatchObject({ cents: 30_000, atLimit: false, shareCents: 27_000 });
    expect(marcus?.myPart).toMatchObject({ cents: 54_000, atLimit: false, shareCents: 45_000 });
    expect(ana?.myPart).toMatchObject({ cents: 6_000, atLimit: true, shareCents: 18_000, careTrips: 2, careMinutes: 180, careValueCents: 6_000 });
    expect(ana).toMatchObject({ state: "planned", shortfallCents: 0, partCount: 3, acceptedCount: 0 });

    expect(await accept(people, people.ana, waiting.id, "checkout")).toBe("planned");
    expect(await accept(people, people.marcus, waiting.id, "pay_later")).toBe("planned");
    expect(await reason(accept(people, people.elena, waiting.id, "monthly_share"))).toBe("invalid");
    expect(await accept(people, people.elena, waiting.id, "invoice")).toBe("agreed");
    const agreed = await stairlift(people, people.ana);
    expect(agreed).toMatchObject({ state: "agreed", acceptedCount: 3 });
    expect(agreed.myPart?.method).toBe("checkout");
    // A demo circle's actions are simulated, so every one is prepared at once.
    expect(agreed.myPart?.preparedAt).not.toBeNull();
    expect((await stairlift(people, people.elena)).myPart?.preparedAt).not.toBeNull();
  });

  it("says only how much is short, and closes the gap by spreading it or by someone taking it on with Pay Later", async () => {
    const people = await family();
    const ask = await stairlift(people, people.elena);
    await seal(people, people.marcus, ask.id, offer(40_000));
    expect(await seal(people, people.ana, ask.id, offer(6_000, { stepUp: { cents: 15_000, fromMonth: nextMonth(ask.startMonth) } }))).toBe("short");
    const short = await stairlift(people, people.elena);
    expect(short).toMatchObject({ state: "short", shortfallCents: 14_000, spreadWouldCover: true });

    expect(await reason(asPerson(db.app, people.marcus, (tx) => spreadQuietShare(tx, { circleId: people.circle.circleId, askId: ask.id })))).toBe("refused");
    expect(await asPerson(db.app, people.marcus, (tx) => takeQuietShareGap(tx, { circleId: people.circle.circleId, askId: ask.id }))).toBe("planned");
    const marcus = await stairlift(people, people.marcus);
    expect(marcus).toMatchObject({ payLaterUsed: true, shortfallCents: 0 });
    expect(marcus.myPart).toMatchObject({ cents: 54_000, payLaterCents: 14_000 });
    expect(await reason(accept(people, people.marcus, ask.id, "checkout"))).toBe("invalid");
    expect(await accept(people, people.marcus, ask.id, "pay_later")).toBe("planned");
  });

  it("spreads a short one-off cost over three months when the organizer chooses it", async () => {
    const people = await family();
    const ask = await stairlift(people, people.elena);
    await seal(people, people.marcus, ask.id, offer(30_000));
    await seal(people, people.ana, ask.id, offer(6_000));
    expect(await asPerson(db.app, people.elena, (tx) => spreadQuietShare(tx, { circleId: people.circle.circleId, askId: ask.id }))).toBe("planned");
    const ana = await stairlift(people, people.ana);
    expect(ana).toMatchObject({ months: SPREAD_MONTHS, state: "planned" });
    expect(ana.myPart).toMatchObject({ cents: 18_000, perMonth: [6_000, 6_000, 6_000] });
  });

  it("raises a new ask for the circle's sharers, lets an offer be changed only a few times, and withdraws an ask that is not agreed", async () => {
    const people = await family();
    const askId = await asPerson(db.app, people.elena, (tx) => raiseQuietShare(tx, { circleId: people.circle.circleId, title: "Care budget", kind: "monthly", costCents: 30_000, billId: null }));
    expect(await asPerson(db.app, people.elena, (tx) => raiseQuietShare(tx, { circleId: people.circle.circleId, title: "Care budget", kind: "monthly", costCents: 30_000, billId: null }))).toBe(askId);
    expect(await reason(asPerson(db.app, people.marcus, (tx) => raiseQuietShare(tx, { circleId: people.circle.circleId, title: "Mine", kind: "one_off", costCents: 100, billId: null })))).toBe("refused");
    expect(await reason(asPerson(db.app, people.elena, (tx) => raiseQuietShare(tx, { circleId: people.circle.circleId, title: "<b>x</b>", kind: "one_off", costCents: 100, billId: null })))).toBe("invalid");
    for (let time = 0; time < 3; time += 1) expect(await seal(people, people.ana, askId, offer(1_000 + time))).toBe("gathering");
    expect(await reason(seal(people, people.ana, askId, offer(5_000)))).toBe("sealed_out");
    expect(await reason(seal(people, people.ana, askId, offer(MAX_OFFER_CENTS + 1)))).toBe("sealed_out");
    await asPerson(db.app, people.elena, (tx) => withdrawQuietShare(tx, { circleId: people.circle.circleId, askId }));
    expect(await reason(seal(people, people.marcus, askId, offer(1_000)))).toBe("closed");
  });

  it("refuses an offer out of range, a step-up that is not a later rise, and a first month before the ask's", async () => {
    const people = await family();
    const ask = await stairlift(people, people.elena);
    expect(await reason(seal(people, people.marcus, ask.id, offer(MAX_OFFER_CENTS + 1)))).toBe("invalid");
    expect(await reason(seal(people, people.marcus, ask.id, offer(5_000, { stepUp: { cents: 4_000, fromMonth: nextMonth(ask.startMonth) } })))).toBe("invalid");
    expect(await reason(seal(people, people.marcus, ask.id, offer(5_000, { stepUp: { cents: 9_000, fromMonth: ask.startMonth } })))).toBe("invalid");
    expect(await reason(seal(people, people.marcus, ask.id, offer(5_000, { earliestMonth: "2020-01" })))).toBe("invalid");
    expect(await reason(seal(people, people.marcus, ask.id, offer(5_000, { careMinutes: 99_999 })))).toBe("invalid");
    expect((await stairlift(people, people.elena)).answeredCount).toBe(1);
  });
});

function nextMonth(month: string): string {
  const [year, number] = month.split("-").map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01` : `${year}-${String(number + 1).padStart(2, "0")}`;
}

/** An ask as the domain's property tests draw them, with real UUIDs, so ID order is the database's too. */
function randomAsk(random: Random): MediationInput {
  const count = random.int(1, 5);
  const cuts = Array.from({ length: count - 1 }, () => random.int(1, 9_999)).toSorted((a, b) => a - b);
  const edges = [0, ...cuts, 10_000];
  const raw = edges.slice(1).map((edge, index) => edge - (edges[index] ?? 0));
  if (raw.some((bps) => bps <= 0)) return randomAsk(random);
  const hex = () => random.int(0, 0xffff).toString(16).padStart(4, "0");
  const ids = raw.map(() => `${hex()}${hex()}-${hex()}-4${hex().slice(1)}-a${hex().slice(1)}-${hex()}${hex()}${hex()}`);
  const big = random.pick([1_000, 100_000, MAX_OFFER_CENTS]);
  const offers: SealedOffer[] = ids.map((memberId) => {
    const monthlyCents = random.int(0, big);
    return {
      memberId,
      monthlyCents,
      stepUp: random.int(0, 2) === 0 && monthlyCents < MAX_OFFER_CENTS ? { cents: random.int(monthlyCents + 1, MAX_OFFER_CENTS), fromMonth: random.pick(["2026-12", "2027-01"]) } : null,
      careTrips: random.int(0, 3),
      careMinutes: random.int(0, 600),
      earliestMonth: random.pick([null, "2026-11", "2026-12", "2027-02"]),
      takesShortfall: random.int(0, 4) === 0,
    };
  });
  return {
    costCents: random.int(1, random.pick([500, 90_000, 5_000_000])),
    startMonth: "2026-11",
    months: random.pick([1, SPREAD_MONTHS]),
    shares: ids.map((memberId, index) => ({ memberId, bps: raw[index] ?? 0 })),
    offers,
    careRateCentsPerHour: random.pick([null, 2500, 3333]),
  };
}

describe("the database's mediator", () => {
  it("gives the same plan as the domain's for any ask, so the rule lives once and is enforced twice", async () => {
    const inputs: MediationInput[] = [];
    forAll(randomAsk, (input) => void inputs.push(input), 120);
    for (const input of inputs) {
      const rows = input.offers.map((each) => ({
        memberId: each.memberId,
        bps: input.shares.find((share) => share.memberId === each.memberId)?.bps,
        monthlyCents: each.monthlyCents,
        stepUpCents: each.stepUp?.cents ?? null,
        stepUpFrom: each.stepUp?.fromMonth ?? null,
        careTrips: each.careTrips,
        careMinutes: each.careMinutes,
        earliestMonth: each.earliestMonth,
        takesShortfall: each.takesShortfall,
      }));
      const result = await db.admin.execute<{ plan: unknown }>(
        sql`select kin_private.mediate_offers(${input.costCents}::bigint, ${input.startMonth}, ${input.months}::integer, ${input.careRateCentsPerHour}::bigint, ${JSON.stringify(rows)}::jsonb) as plan`,
      );
      expect({ input, plan: result.rows[0]?.plan }).toEqual({ input, plan: mediateQuietShare(input) });
    }
  });
});
