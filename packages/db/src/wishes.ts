import {
  WISH_RULE_KINDS,
  WISH_TRIGGERS,
  discretionaryPause,
  wishEffects,
  type ActiveTrigger,
  type Attestation,
  type AttestationStance,
  type DiscretionaryPause,
  type InForceWish,
  type TriggerEvent,
  type WishEffects,
  type WishRule,
  type WishState,
  type WishTrigger,
  type WishTriggerState,
} from "@kin/domain";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { Transaction } from "./connection.ts";
import type { ApprovalMethod } from "./values.ts";
import { parentSubscriptions, wishAttestations, wishes, wishRecordings, wishSignatures, wishTriggers } from "./schema/index.ts";

/** The outbox topic that asks the worker to suspend or resume a real subscription through PayPal. */
export const WISH_SUBSCRIPTION_TOPIC = "wish.subscription";

/**
 * `refused`: the person may not do this. `invalid`: not a wish or subscription the record can hold.
 * `frozen`: a trigger is open, so her wishes stay as they are. `waiting`: a change of this wish already waits.
 * `closed`: the wish is not in a state for this. `active`: the trigger is active already, or not a report.
 * `other_event`: a different event is reported or active. `nothing_active`: nothing is active to end.
 * `busy`: too many recordings today.
 */
export type WishReason = "refused" | "invalid" | "frozen" | "waiting" | "closed" | "active" | "other_event" | "nothing_active" | "busy";

/** A wish, a trigger or a subscription could not be written. Retrying the same request cannot help. */
export class WishError extends Error {
  readonly retryable = false;
  readonly reason: WishReason;

  constructor(reason: WishReason) {
    super(`Wish refused: ${reason}`);
    this.name = "WishError";
    this.reason = reason;
  }
}

/** One version of one of her wishes, with its signatures. */
export type WishRecord = InForceWish & {
  readonly state: WishState;
  readonly digest: string;
  readonly previousDigest: string | null;
  /** Her own recording, or `null` when the wish is read aloud by Kin's voice. */
  readonly recordingId: string | null;
  readonly simulated: boolean;
  readonly createdAt: Date;
  readonly confirmedAt: Date | null;
  readonly inForceAt: Date | null;
  readonly closedAt: Date | null;
  readonly signatures: readonly { readonly memberId: string; readonly role: string; readonly capacity: "parent" | "witness"; readonly method: ApprovalMethod; readonly at: Date }[];
};

export type WishTriggerRecord = {
  readonly id: string;
  readonly event: TriggerEvent;
  readonly state: WishTriggerState;
  readonly reportedBy: string;
  readonly reportedAt: Date;
  readonly activeAt: Date | null;
  readonly closedAt: Date | null;
  readonly organizerBefore: string | null;
  readonly organizerDuring: string | null;
  readonly simulated: boolean;
  readonly attestations: readonly (Attestation & { readonly at: Date })[];
};

export type ParentSubscriptionRecord = {
  readonly id: string;
  readonly name: string;
  readonly monthlyCents: number;
  readonly state: "active" | "suspending" | "suspended" | "resuming";
  readonly heldBy: string | null;
  readonly simulated: boolean;
  readonly changedAt: Date | null;
};

/** Everything about her wishes the person may see: a caregiver gets the triggers only, which row-level security decides. */
export type WishesSnapshot = {
  /** Every version, oldest first. */
  readonly wishes: readonly WishRecord[];
  /** Every trigger, newest first. */
  readonly triggers: readonly WishTriggerRecord[];
  readonly subscriptions: readonly ParentSubscriptionRecord[];
  /** What her wishes do now, by plain code, or `null` while no trigger is active. */
  readonly effects: WishEffects | null;
};

/** Reads her wishes, their triggers and her subscriptions, as the person (or the service) in `tx`. */
export async function readWishes(tx: Transaction, circleId: string): Promise<WishesSnapshot> {
  const rows = await tx.select().from(wishes).where(eq(wishes.circleId, circleId)).orderBy(asc(wishes.createdAt), asc(wishes.version), asc(wishes.id));
  const signed = rows.length === 0 ? [] : await tx.select().from(wishSignatures).where(inArray(wishSignatures.wishId, rows.map((row) => row.id))).orderBy(asc(wishSignatures.signedAt), asc(wishSignatures.id));
  const signaturesOf = Map.groupBy(signed, (signature) => signature.wishId);
  const records = rows.map((row): WishRecord => ({
    id: row.id,
    wishKey: row.wishKey,
    version: row.version,
    quote: row.quote,
    saidOn: row.saidOn,
    trigger: row.trigger,
    rule: parseWishRule(row.rule),
    state: row.state,
    digest: row.digest,
    previousDigest: row.previousDigest,
    recordingId: row.recordingId,
    simulated: row.simulated,
    createdAt: row.createdAt,
    confirmedAt: row.confirmedAt,
    inForceAt: row.inForceAt,
    closedAt: row.closedAt,
    signatures: (signaturesOf.get(row.id) ?? []).map((signature) => ({ memberId: signature.memberId, role: signature.role, capacity: signature.capacity, method: signature.method, at: signature.signedAt })),
  }));
  const triggers = await readTriggers(tx, circleId);
  const subscriptions = await tx.select().from(parentSubscriptions).where(eq(parentSubscriptions.circleId, circleId)).orderBy(asc(parentSubscriptions.createdAt), asc(parentSubscriptions.id));
  return {
    wishes: records,
    triggers,
    subscriptions: subscriptions.map((row) => ({ id: row.id, name: row.name, monthlyCents: row.monthlyCents, state: row.state, heldBy: row.heldBy, simulated: row.simulated, changedAt: row.changedAt })),
    effects: wishEffects(records.filter((wish) => wish.state === "in_force"), activeOf(triggers)),
  };
}

async function readTriggers(tx: Transaction, circleId: string): Promise<WishTriggerRecord[]> {
  const rows = await tx.select().from(wishTriggers).where(eq(wishTriggers.circleId, circleId)).orderBy(desc(wishTriggers.reportedAt), desc(wishTriggers.id));
  const said = rows.length === 0 ? [] : await tx.select().from(wishAttestations).where(inArray(wishAttestations.triggerId, rows.map((row) => row.id))).orderBy(asc(wishAttestations.attestedAt), asc(wishAttestations.id));
  const saidOf = Map.groupBy(said, (each) => each.triggerId);
  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    state: row.state,
    reportedBy: row.reportedBy,
    reportedAt: row.reportedAt,
    activeAt: row.activeAt,
    closedAt: row.closedAt,
    organizerBefore: row.organizerBefore,
    organizerDuring: row.organizerDuring,
    simulated: row.simulated,
    attestations: (saidOf.get(row.id) ?? []).map((each) => ({ memberId: each.memberId, role: each.role, stance: each.stance, at: each.attestedAt })),
  }));
}

const activeOf = (triggers: readonly WishTriggerRecord[]): ActiveTrigger | null => {
  const active = triggers.find((trigger) => trigger.state === "active");
  return active === undefined || active.activeAt === null ? null : { id: active.id, event: active.event, activeAt: active.activeAt };
};

/**
 * What her wishes do now in the circle, or `null` while no trigger is active:
 * read by the payout and refill paths as Kin's service, and by an answer to a
 * proposal as the person. Only wishes in force count.
 */
export async function readWishEffects(tx: Transaction, circleId: string): Promise<WishEffects | null> {
  const [trigger] = await tx
    .select({ id: wishTriggers.id, event: wishTriggers.event, activeAt: wishTriggers.activeAt })
    .from(wishTriggers)
    .where(and(eq(wishTriggers.circleId, circleId), eq(wishTriggers.state, "active")));
  if (!trigger || trigger.activeAt === null) return null;
  const rows = await tx.select().from(wishes).where(and(eq(wishes.circleId, circleId), eq(wishes.state, "in_force")));
  const inForce = rows.map((row): InForceWish => ({ id: row.id, wishKey: row.wishKey, version: row.version, quote: row.quote, saidOn: row.saidOn, trigger: row.trigger, rule: parseWishRule(row.rule) }));
  return wishEffects(inForce, { id: trigger.id, event: trigger.event, activeAt: trigger.activeAt });
}

/**
 * Is discretionary spending paused for this circle, and why: the wish that
 * pauses it and the trigger that made it apply. Anything that spends on the
 * parent's behalf beyond care asks this before it spends.
 */
export async function readDiscretionaryPause(tx: Transaction, circleId: string): Promise<DiscretionaryPause> {
  return discretionaryPause(await readWishEffects(tx, circleId));
}

// ---------------------------------------------------------------------------
// Writing, as the person
// ---------------------------------------------------------------------------

/** Keeps her recording, as WAV bytes. The parent only. */
export async function storeWishRecording(tx: Transaction, input: { readonly circleId: string; readonly wav: Uint8Array }): Promise<string> {
  return wishOperation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.store_wish_recording(${input.circleId}::uuid, ${Buffer.from(input.wav)}::bytea) as id`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Keeping the recording returned no ID");
    return id;
  });
}

/** Her recording, as the person may read it, or `null`. */
export async function readWishRecording(tx: Transaction, input: { readonly circleId: string; readonly recordingId: string }): Promise<{ readonly audio: Uint8Array; readonly contentType: string } | null> {
  const [row] = await tx
    .select({ audio: wishRecordings.audio, contentType: wishRecordings.contentType })
    .from(wishRecordings)
    .where(and(eq(wishRecordings.circleId, input.circleId), eq(wishRecordings.id, input.recordingId)));
  return row ?? null;
}

/** A draft of her wish, as Kin read it back, or the next version of one with `wishKey`. The parent only. */
export async function recordWish(
  tx: Transaction,
  input: { readonly circleId: string; readonly quote: string; readonly trigger: WishTrigger; readonly rule: WishRule; readonly recordingId: string | null; readonly wishKey: string | null },
): Promise<string> {
  const body = { quote: input.quote, trigger: input.trigger, rule: input.rule, recordingId: input.recordingId, wishKey: input.wishKey };
  return wishOperation(async () => {
    const result = await tx.execute<{ id: string }>(sql`select kin_private.record_wish(${input.circleId}::uuid, ${JSON.stringify(body)}::jsonb) as id`);
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Recording the wish returned no ID");
    return id;
  });
}

/** She confirms what Kin read back. Confirming twice changes nothing. */
export async function confirmWish(tx: Transaction, input: { readonly circleId: string; readonly wishId: string; readonly method: "app" | "voice" }): Promise<void> {
  await wishOperation(() => tx.execute(sql`select kin_private.confirm_wish(${input.circleId}::uuid, ${input.wishId}::uuid, ${input.method}::approval_method)`));
}

/** A family member witnesses a wish she confirmed; the second puts it in force. Returns the wish's state after. */
export async function witnessWish(tx: Transaction, input: { readonly circleId: string; readonly wishId: string }): Promise<WishState> {
  return wishOperation(async () => {
    const result = await tx.execute<{ state: WishState }>(sql`select kin_private.witness_wish(${input.circleId}::uuid, ${input.wishId}::uuid) as state`);
    return result.rows[0]?.state ?? "confirmed";
  });
}

/** She takes a wish back. */
export async function withdrawWish(tx: Transaction, input: { readonly circleId: string; readonly wishId: string }): Promise<void> {
  await wishOperation(() => tx.execute(sql`select kin_private.withdraw_wish(${input.circleId}::uuid, ${input.wishId}::uuid)`));
}

/** One person's word that the event happened (`start`) or that she is home (`end`). Returns the trigger and where it stands. */
export async function attestWishTrigger(
  tx: Transaction,
  input: { readonly circleId: string; readonly event: TriggerEvent; readonly stance: AttestationStance },
): Promise<{ readonly triggerId: string; readonly state: WishTriggerState }> {
  return wishOperation(async () => {
    const result = await tx.execute<{ outcome: { triggerId: string; state: WishTriggerState } }>(
      sql`select kin_private.attest_wish_trigger(${input.circleId}::uuid, ${input.event}, ${input.stance}) as outcome`,
    );
    const outcome = result.rows[0]?.outcome;
    if (!outcome) throw new Error("Attesting returned nothing");
    return outcome;
  });
}

/** Takes back a report nobody confirmed. */
export async function dismissWishTrigger(tx: Transaction, input: { readonly circleId: string; readonly triggerId: string }): Promise<void> {
  await wishOperation(() => tx.execute(sql`select kin_private.dismiss_wish_trigger(${input.circleId}::uuid, ${input.triggerId}::uuid)`));
}

/** Tells Kin about a subscription the parent pays, as the organizer. */
export async function addParentSubscription(
  tx: Transaction,
  input: { readonly circleId: string; readonly name: string; readonly monthlyCents: number; readonly paypalSubscriptionId: string | null },
): Promise<string> {
  return wishOperation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.add_parent_subscription(${input.circleId}::uuid, ${input.name}, ${input.monthlyCents}::bigint, ${input.paypalSubscriptionId}) as id`,
    );
    const id = result.rows[0]?.id;
    if (!id) throw new Error("Adding the subscription returned no ID");
    return id;
  });
}

const REASONS: Readonly<Record<string, WishReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "23505": "waiting",
  KW001: "frozen",
  KW002: "waiting",
  KW003: "closed",
  KW004: "active",
  KW005: "other_event",
  KW006: "nothing_active",
  KW007: "busy",
};

async function wishOperation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[codeOf(error) ?? ""];
    if (reason) throw new WishError(reason);
    throw error;
  }
}

function codeOf(error: unknown): string | null {
  if (error === null || typeof error !== "object") return null;
  if ("code" in error && typeof error.code === "string") return error.code;
  return "cause" in error ? codeOf(error.cause) : null;
}

// ---------------------------------------------------------------------------
// The stored rule, and the digest
// ---------------------------------------------------------------------------

/** A stored rule that is not one Kin could have written. */
export class StoredWishError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(`A stored wish is malformed: ${message}`);
    this.name = "StoredWishError";
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const texts = (value: unknown, what: string): string[] => {
  if (!Array.isArray(value) || !value.every((each) => typeof each === "string")) throw new StoredWishError(`${what} is not a list of text`);
  return value;
};
const textOf = (value: unknown, what: string): string => {
  if (typeof value !== "string" || value === "") throw new StoredWishError(`${what} is not text`);
  return value;
};

/** Reads back a stored rule. Storage is checked, not trusted. */
export function parseWishRule(value: unknown): WishRule {
  if (!isObject(value)) throw new StoredWishError("not an object");
  const kind = WISH_RULE_KINDS.find((each) => each === value.kind);
  switch (kind) {
    case "keep_paying":
      return { kind, payeeId: textOf(value.payeeId, "payeeId") };
    case "pause_discretionary":
      return { kind };
    case "suspend_subscriptions":
      return { kind, subscriptionIds: texts(value.subscriptionIds, "subscriptionIds") };
    case "new_payee_approvals": {
      const cents = value.aboveCents;
      if (typeof cents !== "number" || !Number.isSafeInteger(cents) || cents <= 0) throw new StoredWishError("aboveCents is not whole cents");
      return { kind, aboveCents: cents, approverMemberIds: texts(value.approverMemberIds, "approverMemberIds") };
    }
    case "successor":
      return { kind, memberId: textOf(value.memberId, "memberId") };
    default:
      throw new StoredWishError("unknown kind");
  }
}

/** Whether `value` is a trigger a wish may be written for. */
export const isWishTrigger = (value: unknown): value is WishTrigger => WISH_TRIGGERS.some((each) => each === value);

/**
 * The text PostgreSQL prints for a jsonb value: objects with their keys
 * ordered by length and then by bytes, `", "` between items and `": "` after
 * a key. The digest is taken over it in the database, so this is how Kin
 * checks a digest outside it.
 */
export function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(jsonbText).join(", ")}]`;
  if (isObject(value)) {
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).toSorted((a, b) => Buffer.byteLength(a) - Buffer.byteLength(b) || Buffer.compare(Buffer.from(a), Buffer.from(b)));
    return `{${keys.map((key) => `${JSON.stringify(key)}: ${jsonbText(value[key])}`).join(", ")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** A version's digest, as `kin_private.wish_digest` takes it: over the digest before it and the version's content. */
export function wishDigest(wish: { readonly previousDigest: string | null; readonly wishKey: string; readonly version: number; readonly quote: string; readonly saidOn: string; readonly trigger: WishTrigger; readonly rule: WishRule }): string {
  const content = jsonbText([wish.wishKey, wish.version, wish.quote, wish.saidOn, wish.trigger, wish.rule]);
  return createHash("sha256").update(`${wish.previousDigest ?? ""}\n${content}`, "utf8").digest("hex");
}

/** Whether every version's digest is its content's and each follows the one before it: the history was not rewritten. */
export function wishChainHolds(versions: readonly Pick<WishRecord, "wishKey" | "version" | "quote" | "saidOn" | "trigger" | "rule" | "digest" | "previousDigest">[]): boolean {
  const byKey = Map.groupBy(versions, (version) => version.wishKey);
  for (const chain of byKey.values()) {
    const ordered = chain.toSorted((a, b) => a.version - b.version);
    let previous: string | null = null;
    for (const [index, version] of ordered.entries()) {
      if (version.version !== index + 1 || version.previousDigest !== previous || wishDigest(version) !== version.digest) return false;
      previous = version.digest;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// The worker: a real subscription, suspended or resumed through PayPal
// ---------------------------------------------------------------------------

export type SubscriptionJob = {
  readonly id: string;
  readonly circleId: string;
  readonly name: string;
  readonly paypalSubscriptionId: string | null;
  readonly state: ParentSubscriptionRecord["state"];
  readonly heldBy: string | null;
  readonly simulated: boolean;
  /** Where the trigger that holds it stands now, so a suspension that lands after she came home is undone. */
  readonly triggerState: WishTriggerState | null;
};

/** The subscription, locked for this transaction, as Kin's service. `null` if it is not this circle's. */
export async function readSubscriptionJob(tx: Transaction, subscriptionId: string): Promise<SubscriptionJob | null> {
  const [row] = await tx.select().from(parentSubscriptions).where(eq(parentSubscriptions.id, subscriptionId)).for("update");
  if (!row) return null;
  const [trigger] = row.heldBy === null ? [] : await tx.select({ state: wishTriggers.state }).from(wishTriggers).where(eq(wishTriggers.id, row.heldBy));
  return {
    id: row.id,
    circleId: row.circleId,
    name: row.name,
    paypalSubscriptionId: row.paypalSubscriptionId,
    state: row.state,
    heldBy: row.heldBy,
    simulated: row.simulated,
    triggerState: trigger?.state ?? null,
  };
}

/** Why a subscription's state is recorded: PayPal's record shows the move, PayPal refused it, or the subscription is gone (cancelled or expired). */
export type SubscriptionOutcome = "confirmed" | "refused" | "gone";

/**
 * Records what PayPal's record says a subscription is now, once Kin read it
 * back: suspended, or active again. A refused move goes back where it came
 * from; one that is gone stays stopped. A suspension PayPal confirmed after she
 * came home moves on to resuming, and a new message asks the worker to resume it.
 */
export async function recordSubscriptionMoved(tx: Transaction, job: SubscriptionJob, to: "suspended" | "active", outcome: SubscriptionOutcome, at: Date): Promise<void> {
  await tx.update(parentSubscriptions).set({ state: to, changedAt: at, ...(to === "active" ? { heldBy: null } : {}) }).where(eq(parentSubscriptions.id, job.id));
  await tx.execute(sql`insert into audit_log (id, circle_id, actor, action, subject_type, subject_id, details, origin)
    values (gen_random_uuid(), ${job.circleId}, 'service', ${`wish.subscription_${to}`}, 'parent_subscription', ${job.id}, ${JSON.stringify({ outcome })}::jsonb, 'worker')`);
  if (to === "suspended" && outcome === "confirmed" && job.triggerState !== "active") {
    await tx.update(parentSubscriptions).set({ state: "resuming", changedAt: at }).where(eq(parentSubscriptions.id, job.id));
    await tx.execute(sql`insert into outbox (id, circle_id, topic, payload) values (gen_random_uuid(), ${job.circleId}, ${WISH_SUBSCRIPTION_TOPIC}, ${JSON.stringify({ subscriptionId: job.id, action: "activate" })}::jsonb)`);
  }
}
