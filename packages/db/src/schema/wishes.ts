import { sql } from "drizzle-orm";
import { boolean, check, customType, date, foreignKey, index, integer, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { ATTESTATION_STANCES, MAX_WISH_CHARS, TRIGGER_EVENTS, WISH_RULE_KINDS, WISH_STATES, WISH_TRIGGER_STATES, WISH_TRIGGERS } from "@kin/domain";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { approvalMethod, circleRole } from "./enums.ts";

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Raw bytes, for a recording of the parent's own voice. */
const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value),
  fromDriver: (value) => new Uint8Array(value),
});

/** The longest recording kept: a minute of 16 kHz, 16-bit speech as WAV, with its header. */
export const MAX_RECORDING_STORED_BYTES = 16_000 * 2 * 60 + 44;
/** The states a subscription the parent pays moves through while her wishes suspend it and resume it. */
export const PARENT_SUBSCRIPTION_STATES = ["active", "suspending", "suspended", "resuming"] as const;
/** The forward moves of a subscription: Kin asks PayPal, then records what PayPal's record says. */
export const PARENT_SUBSCRIPTION_TRANSITIONS = {
  active: ["suspending"],
  suspending: ["suspended", "active"],
  suspended: ["resuming"],
  resuming: ["active", "suspended"],
} as const satisfies Readonly<Record<(typeof PARENT_SUBSCRIPTION_STATES)[number], readonly string[]>>;

/**
 * A recording of the parent saying a wish, in her own voice. Written once by
 * her seat, never changed. A wish with none is read aloud by Kin's voice, and
 * every screen says which it is.
 */
export const wishRecordings = pgTable(
  "wish_recordings",
  {
    id: id(),
    circleId: circleId(),
    recordedBy: uuid("recorded_by").notNull(),
    contentType: text("content_type").notNull(),
    audio: bytes("audio").notNull(),
    sha256: text("sha256").notNull(),
    simulated: boolean("simulated").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "wish_recordings_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "wish_recordings_member_fk", columns: [t.circleId, t.recordedBy], foreignColumns: [members.circleId, members.id] }),
    unique("wish_recordings_circle_row").on(t.circleId, t.id),
    check("wish_recordings_type", sql`${t.contentType} = 'audio/wav'`),
    check("wish_recordings_size", sql.raw(`octet_length(audio) between 45 and ${MAX_RECORDING_STORED_BYTES}`)),
    check("wish_recordings_sha256", sql`${t.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * One version of one of the parent's wishes: her words, kept as said, and the
 * rule that is data, not code. What a version says never changes; a change is
 * a new version of the same `wish_key`, and only `state` and the moments it
 * moved are written after. Each version's digest covers its content and the
 * digest of the version before it, so the history cannot be rewritten.
 */
export const wishes = pgTable(
  "wishes",
  {
    id: id(),
    circleId: circleId(),
    wishKey: uuid("wish_key").notNull(),
    version: integer("version").notNull(),
    quote: text("quote").notNull(),
    saidOn: date("said_on", { mode: "string" }).notNull(),
    trigger: text("trigger", { enum: WISH_TRIGGERS }).notNull(),
    ruleKind: text("rule_kind", { enum: WISH_RULE_KINDS }).notNull(),
    rule: jsonb("rule").notNull(),
    recordingId: uuid("recording_id"),
    state: text("state", { enum: WISH_STATES }).notNull().default("draft"),
    digest: text("digest").notNull(),
    previousDigest: text("previous_digest"),
    /** A wish written in a demo circle is simulated, and shown so. */
    simulated: boolean("simulated").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    confirmedAt: at("confirmed_at"),
    inForceAt: at("in_force_at"),
    closedAt: at("closed_at"),
  },
  (t) => [
    foreignKey({ name: "wishes_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "wishes_created_by_fk", columns: [t.circleId, t.createdBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "wishes_recording_fk", columns: [t.circleId, t.recordingId], foreignColumns: [wishRecordings.circleId, wishRecordings.id] }),
    unique("wishes_circle_row").on(t.circleId, t.id),
    unique("wishes_one_version").on(t.circleId, t.wishKey, t.version),
    // One version of a wish is in force at a time, and one change of it waits at a time.
    uniqueIndex("wishes_one_in_force").on(t.circleId, t.wishKey).where(sql`state = 'in_force'`),
    uniqueIndex("wishes_one_waiting").on(t.circleId, t.wishKey).where(sql`state in ('draft', 'confirmed')`),
    index("wishes_state_idx").on(t.circleId, t.state),
    check("wishes_version", sql`${t.version} >= 1`),
    check("wishes_quote", sql.raw(`char_length(quote) between 1 and ${MAX_WISH_CHARS} and quote !~ '[<>]' and quote = btrim(quote)`)),
    check("wishes_trigger", sql.raw(`trigger in (${quoted(WISH_TRIGGERS)})`)),
    check("wishes_rule_kind", sql.raw(`rule_kind in (${quoted(WISH_RULE_KINDS)})`)),
    check("wishes_rule_shape", sql`jsonb_typeof(${t.rule}) = 'object' and ${t.rule} ->> 'kind' = ${t.ruleKind}`),
    check("wishes_state", sql.raw(`state in (${quoted(WISH_STATES)})`)),
    check("wishes_digest", sql`${t.digest} ~ '^[0-9a-f]{64}$' and (${t.previousDigest} is null or ${t.previousDigest} ~ '^[0-9a-f]{64}$')`),
    check("wishes_chain", sql`(${t.version} = 1) = (${t.previousDigest} is null)`),
  ],
);

/** The parent's confirmation of what Kin read back, and each witness's signature, over the wish's digest. Written once, never changed. */
export const wishSignatures = pgTable(
  "wish_signatures",
  {
    id: id(),
    circleId: circleId(),
    wishId: uuid("wish_id").notNull(),
    memberId: uuid("member_id").notNull(),
    role: circleRole("role").notNull(),
    capacity: text("capacity", { enum: ["parent", "witness"] }).notNull(),
    digest: text("digest").notNull(),
    method: approvalMethod("method").notNull(),
    signedAt: at("signed_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "wish_signatures_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "wish_signatures_wish_fk", columns: [t.circleId, t.wishId], foreignColumns: [wishes.circleId, wishes.id] }),
    foreignKey({ name: "wish_signatures_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("wish_signatures_one_per_member").on(t.wishId, t.memberId),
    check("wish_signatures_capacity", sql`${t.capacity} in ('parent', 'witness') and (${t.capacity} = 'parent') = (${t.role} = 'parent')`),
  ],
);

/**
 * A trigger: what people said happened to the parent. Reported by one person,
 * active once a second confirms it, ended when two say she is home. At most
 * one is open in a circle at a time. While it is active, her wishes apply.
 */
export const wishTriggers = pgTable(
  "wish_triggers",
  {
    id: id(),
    circleId: circleId(),
    event: text("event", { enum: TRIGGER_EVENTS }).notNull(),
    state: text("state", { enum: WISH_TRIGGER_STATES }).notNull().default("reported"),
    reportedBy: uuid("reported_by").notNull(),
    reportedAt: at("reported_at").notNull(),
    activeAt: at("active_at"),
    closedAt: at("closed_at"),
    /** The organizer before a wish passed the seat on, and the member it passed to, so coming home gives it back. */
    organizerBefore: uuid("organizer_before"),
    organizerDuring: uuid("organizer_during"),
    simulated: boolean("simulated").notNull(),
  },
  (t) => [
    foreignKey({ name: "wish_triggers_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "wish_triggers_reported_by_fk", columns: [t.circleId, t.reportedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "wish_triggers_organizer_before_fk", columns: [t.circleId, t.organizerBefore], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "wish_triggers_organizer_during_fk", columns: [t.circleId, t.organizerDuring], foreignColumns: [members.circleId, members.id] }),
    unique("wish_triggers_circle_row").on(t.circleId, t.id),
    uniqueIndex("wish_triggers_one_open").on(t.circleId).where(sql`state in ('reported', 'active')`),
    check("wish_triggers_event", sql.raw(`event in (${quoted(TRIGGER_EVENTS)})`)),
    check("wish_triggers_state", sql.raw(`state in (${quoted(WISH_TRIGGER_STATES)})`)),
    check("wish_triggers_succession", sql`(${t.organizerBefore} is null) = (${t.organizerDuring} is null)`),
  ],
);

/** One person's word that the event happened, or that she is home. Written once, never changed. */
export const wishAttestations = pgTable(
  "wish_attestations",
  {
    id: id(),
    circleId: circleId(),
    triggerId: uuid("trigger_id").notNull(),
    memberId: uuid("member_id").notNull(),
    role: circleRole("role").notNull(),
    stance: text("stance", { enum: ATTESTATION_STANCES }).notNull(),
    attestedAt: at("attested_at").notNull(),
  },
  (t) => [
    foreignKey({ name: "wish_attestations_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "wish_attestations_trigger_fk", columns: [t.circleId, t.triggerId], foreignColumns: [wishTriggers.circleId, wishTriggers.id] }),
    foreignKey({ name: "wish_attestations_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    unique("wish_attestations_once").on(t.triggerId, t.memberId, t.stance),
    check("wish_attestations_stance", sql.raw(`stance in (${quoted(ATTESTATION_STANCES)})`)),
    check("wish_attestations_role", sql`${t.role} in ('organizer', 'contributor', 'caregiver')`),
  ],
);

/**
 * A subscription the parent pays, which a wish can name. A real one carries its
 * PayPal subscription ID, and Kin's worker suspends and resumes it through
 * PayPal; a demo circle's is simulated and labelled so.
 */
export const parentSubscriptions = pgTable(
  "parent_subscriptions",
  {
    id: id(),
    circleId: circleId(),
    name: text("name").notNull(),
    monthlyCents: cents("monthly_cents").notNull(),
    paypalSubscriptionId: text("paypal_subscription_id"),
    state: text("state", { enum: PARENT_SUBSCRIPTION_STATES }).notNull().default("active"),
    /** The trigger that suspended it, so coming home resumes only what her wishes paused. */
    heldBy: uuid("held_by"),
    simulated: boolean("simulated").notNull(),
    changedAt: at("changed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "parent_subscriptions_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "parent_subscriptions_held_by_fk", columns: [t.circleId, t.heldBy], foreignColumns: [wishTriggers.circleId, wishTriggers.id] }),
    unique("parent_subscriptions_circle_row").on(t.circleId, t.id),
    check("parent_subscriptions_name", sql`char_length(${t.name}) between 1 and 80 and ${t.name} !~ '[<>]' and ${t.name} = btrim(${t.name})`),
    check("parent_subscriptions_cents", sql`${t.monthlyCents} > 0 and ${t.monthlyCents} <= 10000000`),
    check("parent_subscriptions_paypal_id", sql`${t.paypalSubscriptionId} is null or ${t.paypalSubscriptionId} ~ '^I-[A-Z0-9]{6,34}$'`),
    check("parent_subscriptions_state", sql.raw(`state in (${quoted(PARENT_SUBSCRIPTION_STATES)})`)),
    // A real subscription is suspended through PayPal, so it names one; a simulated one never does.
    check("parent_subscriptions_real", sql`${t.simulated} or ${t.paypalSubscriptionId} is not null`),
  ],
);
