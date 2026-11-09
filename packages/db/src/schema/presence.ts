import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, jsonb, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { PRESENCE_STATES } from "@kin/domain";

import { at, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";

const STATES = PRESENCE_STATES.map((state) => `'${state}'`).join(", ");

/**
 * A family member Kin may ask "is it really you?": a child or grandchild with a
 * phone number they confirmed by text. They need no Kin account. The number is
 * a secret of the family's: no role of the web app reads the column, and the
 * confirmation link is a bearer token Kin keeps only the SHA-256 of.
 */
export const trustedVoices = pgTable(
  "trusted_voices",
  {
    id: id(),
    circleId: circleId(),
    name: text("name").notNull(),
    /** How they are related to the parent, in the family's own words: "grandson". */
    relationship: text("relationship").notNull(),
    phone: text("phone").notNull(),
    /** The language Kin texts and calls them in. */
    locale: text("locale").notNull().default("en"),
    /** Other ways the family writes or says this name, such as the name in Hebrew or Arabic letters. A caller who uses one is matched to this person. */
    aliases: text("aliases").array().notNull().default(sql`'{}'`),
    /**
     * The PayPal account the person said, from their own phone, is theirs: the only place help for them can ever go. Held by the
     * service role alone; the app sees only whether one is confirmed.
     */
    paypalReceiver: text("paypal_receiver"),
    receiverConfirmedAt: at("receiver_confirmed_at"),
    /** SHA-256 of the confirmation link's token, until it is used. */
    confirmTokenHash: text("confirm_token_hash"),
    confirmExpiresAt: at("confirm_expires_at"),
    /** When they confirmed the number from their own phone. Only a confirmed voice is ever asked. */
    confirmedAt: at("confirmed_at"),
    addedBy: uuid("added_by").notNull(),
    /** A demo circle's family member is a stand-in: nothing is texted, and the screen says so. */
    simulated: boolean("simulated").notNull().default(false),
    removedAt: at("removed_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "trusted_voices_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "trusted_voices_added_by_fk", columns: [t.circleId, t.addedBy], foreignColumns: [members.circleId, members.id] }),
    unique("trusted_voices_circle_row").on(t.circleId, t.id),
    uniqueIndex("trusted_voices_phone").on(t.circleId, t.phone).where(sql`${t.removedAt} is null`),
    uniqueIndex("trusted_voices_confirm_token").on(t.confirmTokenHash).where(sql`${t.confirmTokenHash} is not null`),
    check("trusted_voices_name", sql`length(btrim(${t.name})) between 1 and 80`),
    check("trusted_voices_relationship", sql`length(btrim(${t.relationship})) between 1 and 80`),
    check("trusted_voices_phone_shape", sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("trusted_voices_locale", sql`${t.locale} in ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')`),
    check("trusted_voices_aliases", sql`cardinality(${t.aliases}) <= 5 and length(array_to_string(${t.aliases}, '')) <= 400`),
    check("trusted_voices_receiver", sql`(${t.paypalReceiver} is null) = (${t.receiverConfirmedAt} is null) and (${t.paypalReceiver} is null or ${t.paypalReceiver} ~ '^[^@[:space:]]+@[^@[:space:]]+\\.[^@[:space:]]+$')`),
    check("trusted_voices_hash", sql`${t.confirmTokenHash} is null or ${t.confirmTokenHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

/**
 * One "is it really you?" check: what the parent was told on a call that said
 * it was family, whom it claimed to be, and what the real person answered.
 * The parent's own words are kept as data and never read as instructions. The
 * state only moves forward through `PRESENCE_TRANSITIONS`.
 */
export const presenceChecks = pgTable(
  "presence_checks",
  {
    id: id(),
    circleId: circleId(),
    /** `app` when a member told Kin, `phone` when the parent rang Kin's line. */
    source: text("source").notNull(),
    /** Twilio's id for the call that reported it, so a retried webhook records it once. */
    callSid: text("call_sid"),
    /** The member who reported it. `null` for a call over the telephone line. */
    openedBy: uuid("opened_by"),
    /** The trusted person Kin matched the claim to. `null` when nobody on the list fits. */
    voiceId: uuid("voice_id"),
    claimedName: text("claimed_name"),
    claimedRelationship: text("claimed_relationship"),
    claimedCents: bigint("claimed_cents", { mode: "number" }),
    /** Scam markers found by rules: secrecy, urgency, gift cards and so on. */
    markers: text("markers").array().notNull().default(sql`'{}'`),
    /** What the parent said, in order. Untrusted content kept for the record. */
    said: text("said").array().notNull().default(sql`'{}'`),
    state: text("state").notNull().default("opened"),
    locale: text("locale").notNull().default("en"),
    /** SHA-256 of the link the real person is sent. */
    tokenHash: text("token_hash").notNull(),
    /** Twilio's id for the text, once it was accepted for delivery. */
    askMessageSid: text("ask_message_sid"),
    /** When Kin first tried to call the real person, because the text went unanswered. Written before the dial, so a call is never placed twice. */
    callAttemptedAt: at("call_attempted_at"),
    /** Twilio's id for that call, which ties its answer back to this check. */
    askCallSid: text("ask_call_sid"),
    /** How the real person answered: from the link in the text, or on Kin's call. */
    answeredVia: text("answered_via"),
    /** The help payment the family raised after a "yes, it was me". At most one per check. Its foreign key is in the access migration. */
    helpProposalId: uuid("help_proposal_id"),
    askedAt: at("asked_at"),
    expiresAt: at("expires_at").notNull(),
    answeredAt: at("answered_at"),
    /** Outgoing money is held until this time because of this check. `null` means no hold. */
    holdUntil: at("hold_until"),
    /** The family's alerts, worded from the record when the check was opened: one for each way it can end. */
    alerts: jsonb("alerts").notNull().default(sql`'{}'::jsonb`),
    /** A demo circle's check is simulated: no text is sent and the screen says so. */
    simulated: boolean("simulated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "presence_checks_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "presence_checks_opened_by_fk", columns: [t.circleId, t.openedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "presence_checks_voice_fk", columns: [t.circleId, t.voiceId], foreignColumns: [trustedVoices.circleId, trustedVoices.id] }),
    unique("presence_checks_circle_row").on(t.circleId, t.id),
    unique("presence_checks_token").on(t.tokenHash),
    uniqueIndex("presence_checks_call").on(t.circleId, t.callSid).where(sql`${t.callSid} is not null`),
    index("presence_checks_circle_idx").on(t.circleId, t.createdAt),
    check("presence_checks_source", sql`${t.source} in ('app', 'phone')`),
    check("presence_checks_state", sql.raw(`state in (${STATES})`)),
    check("presence_checks_amount", sql`${t.claimedCents} is null or ${t.claimedCents} > 0`),
    check("presence_checks_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("presence_checks_locale", sql`${t.locale} in ('en', 'fr', 'de', 'it', 'es', 'ar', 'he')`),
    check("presence_checks_answered_via", sql`${t.answeredVia} is null or ${t.answeredVia} in ('link', 'call')`),
    check("presence_checks_call_sid", sql`${t.askCallSid} is null or ${t.askCallSid} ~ '^[A-Za-z0-9]{1,64}$'`),
    check("presence_checks_said", sql`cardinality(${t.said}) <= 12`),
  ],
);

/**
 * The seed of a circle's weekly family code: three plain words that change every week without anyone choosing them, which
 * real family know and a cloned voice cannot. Only the seed is stored; the words are worked out from it and the week. No
 * role of the web app reads this table: the operation that hands the seed to a member checks who asks.
 */
export const familyCodes = pgTable(
  "family_codes",
  {
    id: id(),
    circleId: circleId(),
    seed: text("seed").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "family_codes_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    unique("family_codes_one_per_circle").on(t.circleId),
    check("family_codes_seed", sql`${t.seed} ~ '^[0-9a-f]{64}$'`),
  ],
);
