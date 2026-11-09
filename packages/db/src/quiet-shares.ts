import type { QuietPartMethod, QuietShareKind, QuietShareState, SealedOffer } from "@kin/domain";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { Transaction } from "./connection.ts";
import { members, quietShareAsks, quietShareParts, sealedOffers } from "./schema/index.ts";

/**
 * `refused`: the person may not do this, or the ask is not theirs to answer.
 * `invalid`: the offer or the ask is not one Kin can hold.
 * `closed`: the ask is not in a state that allows this.
 * `sealed_out`: the person has sealed their offer as many times as Kin allows.
 */
export type QuietShareReason = "refused" | "invalid" | "closed" | "sealed_out";

/** A quiet-share operation was refused. Retrying the same request cannot help. */
export class QuietShareError extends Error {
  readonly retryable = false;
  readonly reason: QuietShareReason;

  constructor(reason: QuietShareReason) {
    super(`Quiet share refused: ${reason}`);
    this.name = "QuietShareError";
    this.reason = reason;
  }
}

/** The person's own offer, as only they can read it. */
export type OwnOfferRecord = Omit<SealedOffer, "memberId"> & { readonly seals: number; readonly sealedAt: Date };

/** The person's own part of the latest plan, as only they can read it. */
export type OwnPartRecord = {
  readonly cents: number;
  readonly perMonth: readonly number[];
  readonly payLaterCents: number;
  readonly atLimit: boolean;
  readonly shareCents: number;
  readonly careTrips: number;
  readonly careMinutes: number;
  readonly careValueCents: number;
  readonly acceptedAt: Date | null;
  readonly method: QuietPartMethod | null;
  readonly preparedAt: Date | null;
  readonly approvalUrl: string | null;
};

export type QuietShareRecord = {
  readonly id: string;
  readonly title: string;
  readonly kind: QuietShareKind;
  readonly costCents: number;
  readonly billId: string | null;
  readonly state: QuietShareState;
  readonly startMonth: string;
  readonly months: number;
  readonly askedCount: number;
  readonly answeredCount: number;
  readonly partCount: number;
  readonly acceptedCount: number;
  readonly shortfallCents: number | null;
  readonly spreadWouldCover: boolean | null;
  readonly payLaterUsed: boolean;
  readonly simulated: boolean;
  readonly raisedBy: string;
  readonly raisedByName: string;
  readonly createdAt: Date;
  readonly decidedAt: Date | null;
  /** Whether the person reading is one of those asked. */
  readonly iAmAsked: boolean;
  readonly myOffer: OwnOfferRecord | null;
  readonly myPart: OwnPartRecord | null;
};

/**
 * The asks the person may see, newest first, each with their own offer and
 * their own part of the latest plan. Read as the person: row-level security
 * returns an offer and a part only to their own person, so nothing here ever
 * holds someone else's limit.
 */
export async function readQuietShares(tx: Transaction, input: { readonly circleId: string; readonly memberId: string }): Promise<QuietShareRecord[]> {
  const asks = await tx
    .select({ ask: quietShareAsks, raisedByName: members.displayName })
    .from(quietShareAsks)
    .innerJoin(members, and(eq(members.circleId, quietShareAsks.circleId), eq(members.id, quietShareAsks.raisedBy)))
    .where(eq(quietShareAsks.circleId, input.circleId))
    .orderBy(desc(quietShareAsks.createdAt), desc(quietShareAsks.id));
  if (asks.length === 0) return [];
  const ids = asks.map(({ ask }) => ask.id);
  const offers = await tx.select().from(sealedOffers).where(and(eq(sealedOffers.circleId, input.circleId), inArray(sealedOffers.askId, ids)));
  const parts = await tx.select().from(quietShareParts).where(and(eq(quietShareParts.circleId, input.circleId), inArray(quietShareParts.askId, ids)));
  return asks.map(({ ask, raisedByName }): QuietShareRecord => {
    const offer = offers.find((row) => row.askId === ask.id && row.memberId === input.memberId);
    const part = parts.find((row) => row.askId === ask.id && row.memberId === input.memberId && row.round === ask.round);
    return {
      id: ask.id,
      title: ask.title,
      kind: ask.kind,
      costCents: ask.costCents,
      billId: ask.billId,
      state: ask.state,
      startMonth: ask.startMonth,
      months: ask.months,
      askedCount: ask.asked.length,
      answeredCount: ask.answeredCount,
      partCount: ask.partCount,
      acceptedCount: ask.acceptedCount,
      shortfallCents: ask.shortfallCents,
      spreadWouldCover: ask.spreadWouldCover,
      payLaterUsed: ask.payLaterUsed,
      simulated: ask.simulated,
      raisedBy: ask.raisedBy,
      raisedByName,
      createdAt: ask.createdAt,
      decidedAt: ask.decidedAt,
      iAmAsked: ask.asked.includes(input.memberId),
      myOffer:
        offer === undefined
          ? null
          : {
              monthlyCents: offer.monthlyCents,
              stepUp: offer.stepUpCents === null || offer.stepUpFrom === null ? null : { cents: offer.stepUpCents, fromMonth: offer.stepUpFrom },
              careTrips: offer.careTrips,
              careMinutes: offer.careMinutes,
              earliestMonth: offer.earliestMonth,
              takesShortfall: offer.takesShortfall,
              seals: offer.seals,
              sealedAt: offer.sealedAt,
            },
      myPart:
        part === undefined
          ? null
          : {
              cents: part.cents,
              perMonth: part.perMonth,
              payLaterCents: part.payLaterCents,
              atLimit: part.atLimit,
              shareCents: part.shareCents,
              careTrips: part.careTrips,
              careMinutes: part.careMinutes,
              careValueCents: part.careValueCents,
              acceptedAt: part.acceptedAt,
              method: part.method,
              preparedAt: part.preparedAt,
              approvalUrl: part.approvalUrl,
            },
    };
  });
}

/** Raises an ask for a cost, as the organizer. Raising the same open ask again returns it. */
export async function raiseQuietShare(
  tx: Transaction,
  input: { readonly circleId: string; readonly title: string; readonly kind: QuietShareKind; readonly costCents: number; readonly billId: string | null },
): Promise<string> {
  return quietShareOperation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.raise_quiet_share(${input.circleId}::uuid, ${input.title}, ${input.kind}, ${input.costCents}::bigint, ${input.billId}::uuid) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Raising the quiet share returned no ask");
    return id;
  });
}

/** What the person confirmed, without their name on it: the database knows whose it is from the seat. */
export type OfferTerms = Omit<SealedOffer, "memberId" | "takesShortfall">;

/** Seals the person's own offer. Returns where the ask stands: once everyone has answered, the mediator has run. */
export async function sealMyOffer(tx: Transaction, input: { readonly circleId: string; readonly askId: string; readonly offer: OfferTerms }): Promise<QuietShareState> {
  const { offer } = input;
  const body = {
    monthlyCents: offer.monthlyCents,
    stepUpCents: offer.stepUp?.cents ?? null,
    stepUpFrom: offer.stepUp?.fromMonth ?? null,
    careTrips: offer.careTrips,
    careMinutes: offer.careMinutes,
    earliestMonth: offer.earliestMonth,
  };
  return stateOf(() => tx.execute<{ state: string }>(sql`select kin_private.seal_my_offer(${input.circleId}::uuid, ${input.askId}::uuid, ${JSON.stringify(body)}::jsonb) as state`));
}

/** Spreads a short one-off cost over three months, as the organizer. */
export function spreadQuietShare(tx: Transaction, input: { readonly circleId: string; readonly askId: string }): Promise<QuietShareState> {
  return stateOf(() => tx.execute<{ state: string }>(sql`select kin_private.spread_quiet_share(${input.circleId}::uuid, ${input.askId}::uuid) as state`));
}

/** The person takes the family's gap on with PayPal Pay Later. */
export function takeQuietShareGap(tx: Transaction, input: { readonly circleId: string; readonly askId: string }): Promise<QuietShareState> {
  return stateOf(() => tx.execute<{ state: string }>(sql`select kin_private.take_quiet_share_gap(${input.circleId}::uuid, ${input.askId}::uuid) as state`));
}

/** The person says yes to their own part and how they will pay it. */
export function acceptMyQuietSharePart(tx: Transaction, input: { readonly circleId: string; readonly askId: string; readonly method: QuietPartMethod }): Promise<QuietShareState> {
  return stateOf(() => tx.execute<{ state: string }>(sql`select kin_private.accept_my_quiet_share_part(${input.circleId}::uuid, ${input.askId}::uuid, ${input.method}) as state`));
}

/** Records the PayPal action prepared for the person's own part in a real circle. */
export async function recordMyQuietShareAction(tx: Transaction, input: { readonly circleId: string; readonly askId: string; readonly paypalRef: string; readonly approvalUrl: string | null }): Promise<void> {
  await quietShareOperation(() => tx.execute(sql`select kin_private.record_my_quiet_share_action(${input.circleId}::uuid, ${input.askId}::uuid, ${input.paypalRef}, ${input.approvalUrl})`));
}

/** Takes back an ask that is not agreed, as the organizer. */
export async function withdrawQuietShare(tx: Transaction, input: { readonly circleId: string; readonly askId: string }): Promise<void> {
  await quietShareOperation(() => tx.execute(sql`select kin_private.withdraw_quiet_share(${input.circleId}::uuid, ${input.askId}::uuid)`));
}

const STATES: readonly QuietShareState[] = ["gathering", "short", "planned", "agreed", "withdrawn"];

async function stateOf(work: () => Promise<{ rows: { state: string }[] }>): Promise<QuietShareState> {
  const result = await quietShareOperation(work);
  const state = STATES.find((each) => each === result.rows[0]?.state);
  if (state === undefined) throw new Error("The quiet share operation returned no state");
  return state;
}

const REASONS: Readonly<Record<string, QuietShareReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "23503": "invalid",
  "22P02": "invalid",
  "22003": "invalid",
  KQ001: "closed",
  KQ002: "sealed_out",
};

async function quietShareOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new QuietShareError(reason);
    throw error;
  }
}

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}
