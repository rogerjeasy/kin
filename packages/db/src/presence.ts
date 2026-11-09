import { PRESENCE_STATES, type PresenceAnswer, type PresenceState, type ScamMarker } from "@kin/domain";
import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";

import { postgresError } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";
import { circles, outbox, presenceChecks, trustedVoices } from "./schema/index.ts";

/**
 * Why a presence operation was refused, as a reason a screen can word. A reason
 * is never a database message. SQLSTATE codes are listed in migration
 * 0040_presence-access.sql.
 */
export type PresenceReason =
  | "refused"
  | "invalid"
  /** The circle has opened six checks this hour: each one texts a real person. */
  | "rate_limited"
  /** The person the claim was matched to is no longer on the list, or never confirmed their number. */
  | "cannot_ask"
  /** The check is not in a state that can take this answer (a "yes" after a "no"). */
  | "wrong_state"
  | "too_many_voices"
  | "duplicate"
  /** Help may not exceed what the caller asked for. */
  | "above_asked"
  /** The person has not confirmed a PayPal account, so help for them has nowhere safe to go. */
  | "no_account"
  /** Help needs the person to have said it was them, and is raised once. */
  | "not_confirmed"
  | "above_ceiling"
  | "paused"
  | "no_agreement"
  /** Help for this person is already moving, so the account cannot change. */
  | "in_progress";

export class PresenceError extends Error {
  readonly retryable = false;
  readonly reason: PresenceReason;

  constructor(reason: PresenceReason) {
    super(`A presence operation was refused: ${reason}`);
    this.name = "PresenceError";
    this.reason = reason;
  }
}

const REASONS: Readonly<Record<string, PresenceReason>> = {
  "42501": "refused",
  "23514": "invalid",
  "22P02": "invalid",
  "22021": "refused",
  "23505": "duplicate",
  KP001: "rate_limited",
  KP002: "cannot_ask",
  KP003: "wrong_state",
  KP004: "too_many_voices",
  KP005: "above_asked",
  KP007: "no_account",
  KP008: "not_confirmed",
  KB006: "above_ceiling",
  KB007: "paused",
  KB008: "no_agreement",
  KB009: "in_progress",
};

async function operation<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const reason = REASONS[postgresError(error)?.code ?? ""];
    if (reason) throw new PresenceError(reason);
    throw error;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function field(raw: unknown, key: string): unknown {
  if (!isObject(raw)) throw new Error("A presence operation returned nothing");
  return raw[key];
}

function text(raw: unknown, key: string): string {
  const value = field(raw, key);
  if (typeof value !== "string") throw new Error(`A presence operation's ${key} is not text`);
  return value;
}

// ---------------------------------------------------------------------------
// Trusted voices
// ---------------------------------------------------------------------------

export type AddTrustedVoiceInput = {
  readonly circleId: string;
  readonly name: string;
  readonly relationship: string;
  /** E.164. */
  readonly phone: string;
  readonly locale: string;
  /** A fresh token (`newCheckToken`): the confirmation text carries it and the database keeps only its hash. */
  readonly token: string;
  /** Other ways the family writes or says the name, such as the name in Hebrew or Arabic letters. At most five. */
  readonly aliases?: readonly string[];
};

export type TrustedVoiceAdded = { readonly id: string; readonly simulated: boolean; readonly confirmed: boolean };

/** Adds a family member Kin may ask. The organizer or the parent, as the person. */
export function addTrustedVoice(tx: Transaction, input: AddTrustedVoiceInput): Promise<TrustedVoiceAdded> {
  return operation(async () => {
    const result = await tx.execute<{ added: unknown }>(
      sql`select kin_private.add_trusted_voice(${input.circleId}::uuid, ${input.name}, ${input.relationship}, ${input.phone}, ${input.locale}, ${input.token}, ${pgArray(input.aliases ?? [])}::text[]) as added`,
    );
    const added = result.rows[0]?.added;
    return { id: text(added, "id"), simulated: field(added, "simulated") === true, confirmed: field(added, "confirmed") === true };
  });
}

/** Changes the other spellings of a family member's name. The organizer or the parent, as the person. */
export function setVoiceAliases(tx: Transaction, circleId: string, voiceId: string, aliases: readonly string[]): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.set_voice_aliases(${circleId}::uuid, ${voiceId}::uuid, ${pgArray(aliases)}::text[])`);
  });
}

/** Texts a family member a fresh link: to confirm their number again, or to give the PayPal account help for them may go to. */
export function reissueVoiceConfirmation(tx: Transaction, circleId: string, voiceId: string, token: string): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.reissue_voice_confirmation(${circleId}::uuid, ${voiceId}::uuid, ${token})`);
  });
}

export function removeTrustedVoice(tx: Transaction, circleId: string, voiceId: string): Promise<void> {
  return operation(async () => {
    await tx.execute(sql`select kin_private.remove_trusted_voice(${circleId}::uuid, ${voiceId}::uuid)`);
  });
}

export type TrustedVoiceRecord = {
  readonly id: string;
  readonly name: string;
  readonly relationship: string;
  readonly locale: string;
  readonly confirmed: boolean;
  readonly simulated: boolean;
  readonly aliases: readonly string[];
  /** Whether the person confirmed a PayPal account for help to go to. Which account is never shown. */
  readonly accountConfirmed: boolean;
};

/** The circle's trusted voices, oldest first. Never a phone number: only the service reads those. */
export async function readTrustedVoices(tx: Transaction, circleId: string): Promise<TrustedVoiceRecord[]> {
  const rows = await tx
    .select({ id: trustedVoices.id, name: trustedVoices.name, relationship: trustedVoices.relationship, locale: trustedVoices.locale, confirmedAt: trustedVoices.confirmedAt, simulated: trustedVoices.simulated, aliases: trustedVoices.aliases, receiverConfirmedAt: trustedVoices.receiverConfirmedAt })
    .from(trustedVoices)
    .where(and(eq(trustedVoices.circleId, circleId), isNull(trustedVoices.removedAt)))
    .orderBy(trustedVoices.createdAt, trustedVoices.id);
  return rows.map((row) => ({ id: row.id, name: row.name, relationship: row.relationship, locale: row.locale, confirmed: row.confirmedAt !== null, simulated: row.simulated, aliases: row.aliases, accountConfirmed: row.receiverConfirmedAt !== null }));
}

export type VoiceConfirmation = { readonly name: string; readonly parentFirstName: string; readonly confirmed: boolean };

function parseConfirmation(raw: unknown): VoiceConfirmation {
  return { name: text(raw, "name"), parentFirstName: text(raw, "parentFirstName"), confirmed: field(raw, "confirmed") === true };
}

/** Looks at a confirmation link without using it. Nobody signed in; a dead link is `refused`. */
export function readVoiceConfirmation(db: Database, token: string): Promise<VoiceConfirmation> {
  return operation(() =>
    db.transaction(async (tx) => {
      const result = await tx.execute<{ status: unknown }>(sql`select kin_private.trusted_voice_status(${token}) as status`);
      return parseConfirmation(result.rows[0]?.status);
    }),
  );
}

/** The person says it is their number and, if they wish, which PayPal account is theirs. Nobody signed in. */
export function confirmTrustedVoice(db: Database, token: string, receiver: string | null = null): Promise<VoiceConfirmation> {
  return operation(() =>
    db.transaction(async (tx) => {
      const result = await tx.execute<{ done: unknown }>(sql`select kin_private.confirm_trusted_voice(${token}, ${receiver}) as done`);
      return parseConfirmation(result.rows[0]?.done);
    }),
  );
}

// ---------------------------------------------------------------------------
// Presence checks
// ---------------------------------------------------------------------------

/** What the family is told for each way a check can end, worded from the record by code. */
export type PresenceAlerts = { readonly denied: string; readonly unreachable: string; readonly confirmed: string; readonly unknown: string };

export type PresenceCheckInput = {
  readonly circleId: string;
  /** The trusted person plain code matched, or `null` when nobody on the list fits. */
  readonly voiceId: string | null;
  readonly claimedName: string | null;
  readonly claimedRelationship: string | null;
  readonly claimedCents: number | null;
  readonly markers: readonly ScamMarker[];
  /** What the parent said, in order. */
  readonly said: readonly string[];
  readonly locale: string;
  /** A fresh token (`newCheckToken`): the link sent to the real person. */
  readonly token: string;
  readonly alerts: PresenceAlerts;
};

export type PresenceOpened = {
  readonly checkId: string;
  readonly state: PresenceState;
  /** A demo circle's check: nothing is texted, and the screen says so. */
  readonly simulated: boolean;
  /** The call had already been recorded: this is the earlier check. */
  readonly repeated: boolean;
};

function parseOpened(raw: unknown): PresenceOpened {
  const state = text(raw, "state");
  if (!PRESENCE_STATES.some((each) => each === state)) throw new Error("A presence check came back in an unknown state");
  return { checkId: text(raw, "checkId"), state: state as PresenceState, simulated: field(raw, "simulated") === true, repeated: field(raw, "repeated") === true };
}

const pgArray = (values: readonly string[]): string => `{${values.map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(",")}}`;

/** A member tells Kin what a caller who said they were family asked for. As the person, inside `asPerson`. */
export function openPresenceCheck(tx: Transaction, input: PresenceCheckInput): Promise<PresenceOpened> {
  return operation(async () => {
    const result = await tx.execute<{ opened: unknown }>(
      sql`select kin_private.open_presence_check(${input.circleId}::uuid, ${input.voiceId}::uuid, ${input.claimedName}, ${input.claimedRelationship}, ${input.claimedCents}::bigint, ${pgArray(input.markers)}::text[], ${pgArray(input.said)}::text[], ${input.locale}, ${input.token}, ${JSON.stringify(input.alerts)}::jsonb) as opened`,
    );
    return parseOpened(result.rows[0]?.opened);
  });
}

/** Kin's phone line records a call. As the service for the circle the dialled number belongs to, inside `asService`. Once per call. */
export function openPresenceCheckByLine(tx: Transaction, input: PresenceCheckInput & { readonly callSid: string }): Promise<PresenceOpened> {
  return operation(async () => {
    const result = await tx.execute<{ opened: unknown }>(
      sql`select kin_private.open_presence_check_by_line(${input.circleId}::uuid, ${input.callSid}, ${input.voiceId}::uuid, ${input.claimedName}, ${input.claimedRelationship}, ${input.claimedCents}::bigint, ${pgArray(input.markers)}::text[], ${pgArray(input.said)}::text[], ${input.locale}, ${input.token}, ${JSON.stringify(input.alerts)}::jsonb) as opened`,
    );
    return parseOpened(result.rows[0]?.opened);
  });
}

export type PresenceCheckRecord = {
  readonly id: string;
  readonly source: "app" | "phone";
  readonly voiceId: string | null;
  readonly claimedName: string | null;
  readonly claimedRelationship: string | null;
  readonly claimedCents: number | null;
  readonly markers: readonly ScamMarker[];
  readonly said: readonly string[];
  readonly state: PresenceState;
  readonly locale: string;
  readonly createdAt: Date;
  readonly askedAt: Date | null;
  readonly answeredAt: Date | null;
  readonly expiresAt: Date;
  readonly holdUntil: Date | null;
  readonly simulated: boolean;
  /** How the real person answered: from the text's link, or on Kin's call. */
  readonly answeredVia: "link" | "call" | null;
  /** The help payment the family raised after a "yes", if any. */
  readonly helpProposalId: string | null;
};

const checkColumns = {
  id: presenceChecks.id,
  source: presenceChecks.source,
  voiceId: presenceChecks.voiceId,
  claimedName: presenceChecks.claimedName,
  claimedRelationship: presenceChecks.claimedRelationship,
  claimedCents: presenceChecks.claimedCents,
  markers: presenceChecks.markers,
  said: presenceChecks.said,
  state: presenceChecks.state,
  locale: presenceChecks.locale,
  createdAt: presenceChecks.createdAt,
  askedAt: presenceChecks.askedAt,
  answeredAt: presenceChecks.answeredAt,
  expiresAt: presenceChecks.expiresAt,
  holdUntil: presenceChecks.holdUntil,
  simulated: presenceChecks.simulated,
  answeredVia: presenceChecks.answeredVia,
  helpProposalId: presenceChecks.helpProposalId,
};

type CheckRow = Omit<PresenceCheckRecord, "source" | "state" | "markers" | "answeredVia"> & { readonly source: string; readonly state: string; readonly markers: string[]; readonly answeredVia: string | null };

function recordOf(row: CheckRow): PresenceCheckRecord {
  // Safe: check constraints hold `source`, `state` and each marker to the domain's lists.
  return { ...row, source: row.source as "app" | "phone", state: row.state as PresenceState, markers: row.markers as ScamMarker[], answeredVia: row.answeredVia as "link" | "call" | null };
}

/** The circle's checks, newest first. Row-level security limits who sees any. */
export async function readPresenceChecks(tx: Transaction, circleId: string, limit = 20): Promise<PresenceCheckRecord[]> {
  const rows = await tx.select(checkColumns).from(presenceChecks).where(eq(presenceChecks.circleId, circleId)).orderBy(desc(presenceChecks.createdAt)).limit(limit);
  return rows.map(recordOf);
}

export async function readPresenceCheck(tx: Transaction, circleId: string, checkId: string): Promise<PresenceCheckRecord | null> {
  const [row] = await tx.select(checkColumns).from(presenceChecks).where(and(eq(presenceChecks.circleId, circleId), eq(presenceChecks.id, checkId)));
  return row === undefined ? null : recordOf(row);
}

/** What a month's checks add up to, for the statement. */
export type PresenceSummary = { readonly checks: number; readonly denied: number; readonly stoppedCents: number };

/** The checks opened in one month on the circle's clock (`YYYY-MM`). A check counts as stopped money only when the real person said "not me". */
export async function readPresenceSummary(tx: Transaction, circleId: string, period: string): Promise<PresenceSummary> {
  const [row] = await tx
    .select({
      checks: sql<number>`count(*)::int`,
      denied: sql<number>`count(*) filter (where ${presenceChecks.state} = 'denied')::int`,
      stoppedCents: sql<string>`coalesce(sum(${presenceChecks.claimedCents}) filter (where ${presenceChecks.state} = 'denied'), 0)`,
    })
    .from(presenceChecks)
    .innerJoin(circles, eq(circles.id, presenceChecks.circleId))
    .where(and(eq(presenceChecks.circleId, circleId), sql`to_char(${presenceChecks.createdAt} at time zone ${circles.timezone}, 'YYYY-MM') = ${period}`));
  return { checks: row?.checks ?? 0, denied: row?.denied ?? 0, stoppedCents: Number(row?.stoppedCents ?? 0) };
}

/**
 * When outgoing money is held until because of a presence check: the latest
 * `hold_until` that is still in the future, or `null`. Read by the payout path,
 * as the service, beside the circle's pause switch, which a check never touches.
 */
export async function presenceHoldUntil(tx: Transaction, circleId: string, now: Date): Promise<Date | null> {
  const [row] = await tx
    .select({ until: sql<Date | null>`max(${presenceChecks.holdUntil})` })
    .from(presenceChecks)
    .where(and(eq(presenceChecks.circleId, circleId), gt(presenceChecks.holdUntil, now)));
  return row?.until ? new Date(row.until) : null;
}

export const laterOf = (a: Date | null, b: Date | null): Date | null => (a === null ? b : b === null ? a : a.getTime() >= b.getTime() ? a : b);

/**
 * Outgoing money is held while an "is it really you?" check is open, and for a
 * day after someone said it was not them. The hold is timed on the real clock,
 * so it is carried onto the circle's clock as the time still left: a demo
 * circle whose clock stands still is held for exactly as long as a real one.
 * The pause switch a person pressed is separate, and is never touched. Every
 * path that moves money out (payouts, refills) reads it through this.
 */
export async function outgoingMoneyHeldByPresence(tx: Transaction, circleId: string, realNow: Date, circleNow: Date): Promise<Date | null> {
  const until = await presenceHoldUntil(tx, circleId, realNow);
  return until === null ? null : new Date(circleNow.getTime() + (until.getTime() - realNow.getTime()));
}

// ---------------------------------------------------------------------------
// The real person's page
// ---------------------------------------------------------------------------

export type PresenceStatus = {
  readonly state: PresenceState;
  readonly voiceFirstName: string;
  readonly parentFirstName: string;
  readonly claimedCents: number | null;
  readonly currency: string;
  readonly timezone: string;
  readonly locale: string;
  readonly simulated: boolean;
  /** The link still counts an answer. */
  readonly canAnswer: boolean;
};

/** Looks at a check's link without answering. Nobody signed in; any dead link is `refused`, whatever is wrong with it. */
export function readPresenceStatus(db: Database, token: string): Promise<PresenceStatus> {
  return operation(() =>
    db.transaction(async (tx) => {
      const result = await tx.execute<{ status: unknown }>(sql`select kin_private.presence_check_status(${token}) as status`);
      const raw = result.rows[0]?.status;
      const state = text(raw, "state");
      if (!PRESENCE_STATES.some((each) => each === state)) throw new Error("A presence check came back in an unknown state");
      const cents = field(raw, "claimedCents");
      return {
        state: state as PresenceState,
        voiceFirstName: text(raw, "voiceFirstName"),
        parentFirstName: text(raw, "parentFirstName"),
        claimedCents: typeof cents === "number" ? cents : null,
        currency: text(raw, "currency"),
        timezone: text(raw, "timezone"),
        locale: text(raw, "locale"),
        simulated: field(raw, "simulated") === true,
        canAnswer: field(raw, "canAnswer") === true,
      };
    }),
  );
}

/** The real person answers. Nobody signed in. A "no" holds outgoing money and tells the family. */
export function answerPresenceCheck(db: Database, input: { readonly token: string; readonly answer: PresenceAnswer }): Promise<{ readonly state: PresenceState; readonly changed: boolean }> {
  return operation(() =>
    db.transaction(async (tx) => {
      const result = await tx.execute<{ answered: unknown }>(sql`select kin_private.answer_presence_check(${input.token}, ${input.answer}) as answered`);
      const raw = result.rows[0]?.answered;
      return { state: text(raw, "state") as PresenceState, changed: field(raw, "changed") === true };
    }),
  );
}

// ---------------------------------------------------------------------------
// The worker's side
// ---------------------------------------------------------------------------

export const PRESENCE_ASK_TOPIC = "presence.ask";
export const PRESENCE_CONFIRM_TOPIC = "presence.confirm";

export type PresenceAskFacts = {
  readonly state: PresenceState;
  readonly expiresAt: Date;
  readonly phone: string;
  readonly locale: string;
  readonly voiceName: string;
  readonly parentName: string;
  readonly claimedCents: number | null;
  readonly currency: string;
  readonly timezone: string;
};

/** Who to text for a check, and what the text says. As the service for the check's circle, inside `asService`. `null` when the check or its person is gone. */
export async function readPresenceAskFacts(tx: Transaction, circleId: string, checkId: string): Promise<PresenceAskFacts | null> {
  const [row] = await tx
    .select({
      state: presenceChecks.state,
      expiresAt: presenceChecks.expiresAt,
      claimedCents: presenceChecks.claimedCents,
      phone: trustedVoices.phone,
      locale: trustedVoices.locale,
      voiceName: trustedVoices.name,
      removedAt: trustedVoices.removedAt,
      currency: circles.currency,
      timezone: circles.timezone,
      parentName: sql<string | null>`(select m.display_name from members m where m.circle_id = ${presenceChecks.circleId} and m.role = 'parent' and m.status = 'active' order by m.joined_at limit 1)`,
    })
    .from(presenceChecks)
    .innerJoin(trustedVoices, and(eq(trustedVoices.circleId, presenceChecks.circleId), eq(trustedVoices.id, presenceChecks.voiceId)))
    .innerJoin(circles, eq(circles.id, presenceChecks.circleId))
    .where(and(eq(presenceChecks.circleId, circleId), eq(presenceChecks.id, checkId)));
  if (row === undefined || row.removedAt !== null) return null;
  return {
    state: row.state as PresenceState,
    expiresAt: row.expiresAt,
    phone: row.phone,
    locale: row.locale,
    voiceName: row.voiceName,
    parentName: row.parentName ?? "",
    claimedCents: row.claimedCents,
    currency: row.currency,
    timezone: row.timezone,
  };
}

export type VoiceConfirmFacts = { readonly phone: string; readonly locale: string; readonly voiceName: string; readonly parentName: string; readonly confirmed: boolean };

/** Who to text a confirmation link, as the service for the circle. `null` when the voice is gone. */
export async function readVoiceConfirmFacts(tx: Transaction, circleId: string, voiceId: string): Promise<VoiceConfirmFacts | null> {
  const [row] = await tx
    .select({
      phone: trustedVoices.phone,
      locale: trustedVoices.locale,
      name: trustedVoices.name,
      confirmedAt: trustedVoices.confirmedAt,
      removedAt: trustedVoices.removedAt,
      parentName: sql<string | null>`(select m.display_name from members m where m.circle_id = ${trustedVoices.circleId} and m.role = 'parent' and m.status = 'active' order by m.joined_at limit 1)`,
    })
    .from(trustedVoices)
    .where(and(eq(trustedVoices.circleId, circleId), eq(trustedVoices.id, voiceId)));
  if (row === undefined || row.removedAt !== null) return null;
  return { phone: row.phone, locale: row.locale, voiceName: row.name, parentName: row.parentName ?? "", confirmed: row.confirmedAt !== null };
}

/** The text went out: the check is `asked`, Twilio's message ID is kept, and the outbox forgets the link. */
export async function recordPresenceAsked(tx: Transaction, circleId: string, checkId: string, messageSid: string): Promise<void> {
  await operation(async () => {
    await tx.execute(sql`select kin_private.record_presence_asked(${circleId}::uuid, ${checkId}::uuid, ${messageSid})`);
  });
}

/** Forgets the link a message carried, whether or not it was sent: no outbox row keeps a credential. As the service for the message's circle. */
export async function stripOutboxToken(tx: Transaction, messageId: string): Promise<void> {
  await tx.update(outbox).set({ payload: sql`${outbox.payload} - 'token'` }).where(eq(outbox.id, messageId));
}

export async function recordVoiceConfirmSent(tx: Transaction, circleId: string, voiceId: string): Promise<void> {
  await operation(async () => {
    await tx.execute(sql`select kin_private.record_voice_confirm_sent(${circleId}::uuid, ${voiceId}::uuid)`);
  });
}

/** Moves the checks whose time has run out and tells the family of those nobody answered. Across circles, as Kin's service. Returns how many moved. */
export async function sweepPresenceChecks(db: Database): Promise<number> {
  return operation(async () => {
    const result = await db.execute<{ moved: number }>(sql`select kin_private.sweep_presence_checks() as moved`);
    return Number(result.rows[0]?.moved ?? 0);
  });
}

// ---------------------------------------------------------------------------
// Kin's phone line
// ---------------------------------------------------------------------------

/** What the phone line needs of a circle to take a parent's call: the currency, the parent's name and who Kin may ask. */
export type PresenceLine = {
  readonly currency: string;
  /** The circle's IANA time zone: the calendar day the weekly family code is worked out on. */
  readonly timezone: string;
  readonly parentName: string;
  readonly voices: readonly { readonly id: string; readonly name: string; readonly relationship: string; readonly aliases: readonly string[] }[];
};

/** The circle as the phone line may read it, as the service. `null` when the circle is not active, so a closed circle's number answers like an unknown one. */
export async function readPresenceLine(tx: Transaction, circleId: string): Promise<PresenceLine | null> {
  const [circle] = await tx.select({ currency: circles.currency, timezone: circles.timezone }).from(circles).where(and(eq(circles.id, circleId), eq(circles.status, "active")));
  if (!circle) return null;
  const [voices, parent] = await Promise.all([
    tx
      .select({ id: trustedVoices.id, name: trustedVoices.name, relationship: trustedVoices.relationship, aliases: trustedVoices.aliases })
      .from(trustedVoices)
      .where(and(eq(trustedVoices.circleId, circleId), isNull(trustedVoices.removedAt), sql`${trustedVoices.confirmedAt} is not null`))
      .orderBy(trustedVoices.createdAt, trustedVoices.id),
    tx.execute<{ name: string | null }>(sql`select display_name as name from members where circle_id = ${circleId}::uuid and role = 'parent' and status = 'active' order by joined_at limit 1`),
  ]);
  return { currency: circle.currency, timezone: circle.timezone, parentName: parent.rows[0]?.name ?? "", voices };
}

export type PresenceLineCheck = { readonly state: PresenceState; readonly voiceName: string | null };

/** How a check the line opened stands, as the service for its circle. `null` when it is not this circle's. */
export async function readPresenceLineCheck(tx: Transaction, circleId: string, checkId: string): Promise<PresenceLineCheck | null> {
  const [row] = await tx
    .select({ state: presenceChecks.state, voiceName: trustedVoices.name })
    .from(presenceChecks)
    .leftJoin(trustedVoices, and(eq(trustedVoices.circleId, presenceChecks.circleId), eq(trustedVoices.id, presenceChecks.voiceId)))
    .where(and(eq(presenceChecks.circleId, circleId), eq(presenceChecks.id, checkId)));
  return row === undefined ? null : { state: row.state as PresenceState, voiceName: row.voiceName };
}

// ---------------------------------------------------------------------------
// Kin's call to the real person
// ---------------------------------------------------------------------------

export type DueCall = { readonly circleId: string; readonly checkId: string };

/** The checks waiting for Kin's call: texted thirty seconds ago and not answered. Across circles, as Kin's service. */
export async function readDuePresenceCalls(db: Database): Promise<DueCall[]> {
  return operation(async () => {
    const result = await db.execute<{ circle_id: string; check_id: string }>(sql`select circle_id, check_id from kin_private.due_presence_calls()`);
    return result.rows.map((row) => ({ circleId: row.circle_id, checkId: row.check_id }));
  });
}

export type PresenceCallToDial = {
  readonly phone: string;
  readonly locale: string;
  readonly name: string;
  readonly parentName: string;
  readonly claimedCents: number | null;
  readonly currency: string;
};

/**
 * Commits the attempt before any dial and says whom to call, or `null` when the check is not due (answered, over, a
 * demo's, or already tried). Run as the service for the check's circle. A second worker, or this one after a crash,
 * gets `null`, so a person is never rung twice.
 */
export async function startPresenceCall(tx: Transaction, circleId: string, checkId: string): Promise<PresenceCallToDial | null> {
  return operation(async () => {
    const result = await tx.execute<{ started: unknown }>(sql`select kin_private.start_presence_call(${circleId}::uuid, ${checkId}::uuid) as started`);
    const raw = result.rows[0]?.started;
    if (raw === null || raw === undefined) return null;
    const cents = field(raw, "claimedCents");
    return { phone: text(raw, "phone"), locale: text(raw, "locale"), name: text(raw, "name"), parentName: text(raw, "parentName"), claimedCents: typeof cents === "number" ? cents : null, currency: text(raw, "currency") };
  });
}

export async function recordPresenceCallSid(tx: Transaction, circleId: string, checkId: string, callSid: string): Promise<void> {
  await operation(async () => {
    await tx.execute(sql`select kin_private.record_presence_call_sid(${circleId}::uuid, ${checkId}::uuid, ${callSid})`);
  });
}

/** The real person answered Kin's call. As the service for the circle, for the very call recorded for this check. */
export function answerPresenceCheckByCall(tx: Transaction, input: { readonly circleId: string; readonly checkId: string; readonly callSid: string; readonly answer: PresenceAnswer }): Promise<{ readonly state: PresenceState; readonly changed: boolean }> {
  return operation(async () => {
    const result = await tx.execute<{ answered: unknown }>(
      sql`select kin_private.answer_presence_check_by_call(${input.circleId}::uuid, ${input.checkId}::uuid, ${input.callSid}, ${input.answer}) as answered`,
    );
    const raw = result.rows[0]?.answered;
    return { state: text(raw, "state") as PresenceState, changed: field(raw, "changed") === true };
  });
}

// ---------------------------------------------------------------------------
// The weekly family code
// ---------------------------------------------------------------------------

/**
 * The secret seed of a circle's weekly family code, made on first use. The organizer, a contributor and the parent may read
 * it (as the person), and Kin's service for its own circle; a caregiver and an observer may not.
 */
export async function readFamilyCodeSeed(tx: Transaction, circleId: string): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ seed: string }>(sql`select kin_private.family_code_seed(${circleId}::uuid) as seed`);
    const seed = result.rows[0]?.seed;
    if (typeof seed !== "string") throw new Error("The family code operation returned no seed");
    return seed;
  });
}

// ---------------------------------------------------------------------------
// Help for someone who said it was really them
// ---------------------------------------------------------------------------

export type HelpPayoutInput = {
  readonly circleId: string;
  readonly checkId: string;
  readonly cents: number;
  /** The family's own words beside the payment, shown on the approval card. */
  readonly note: string;
  /** The approval engine's plan for a payout of this size to a new payee, made by the money core. */
  readonly plan: unknown;
};

/**
 * Raises one payment of help to the person a check confirmed. It is an ordinary payout proposal, approved like any other;
 * the database refuses it unless the person said it was them, confirmed a PayPal account, and the amount is no more than
 * the caller asked for. The money can go only to that account: the payee is made from it alone. Run as the person.
 */
export async function requestHelpPayout(tx: Transaction, input: HelpPayoutInput): Promise<string> {
  return operation(async () => {
    const result = await tx.execute<{ id: string }>(
      sql`select kin_private.request_help_payout(${input.circleId}::uuid, ${input.checkId}::uuid, ${input.cents}::bigint, ${input.note}, ${JSON.stringify(input.plan)}::jsonb) as id`,
    );
    const id = result.rows[0]?.id;
    if (typeof id !== "string") throw new Error("The help operation returned no proposal");
    return id;
  });
}
