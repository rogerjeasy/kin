import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgTable, text, time, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { MAX_SHIFT_CALL_ATTEMPTS, SHIFT_CALL_STATES } from "@kin/domain";

import { at, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { shifts } from "./shifts.ts";

/**
 * A link a caregiver taps (from a text, a printed QR code or an NFC tag at the
 * door) to turn their own key on one shift without signing in. The link is a
 * bearer token: the person who has it acts as the shift's member on that one
 * shift, so Kin stores only the token's SHA-256, never the token. It expires,
 * is rate limited, and can do nothing but check that shift in or out.
 * No role of the web app reads this table: the operations are the only way in.
 */
export const shiftCheckLinks = pgTable(
  "shift_check_links",
  {
    id: id(),
    circleId: circleId(),
    shiftId: uuid("shift_id").notNull(),
    /** The shift's own member, whom the link acts for. Held to the shift's member by a foreign key. */
    memberId: uuid("member_id").notNull(),
    /** SHA-256 of the token, in lowercase hex. */
    tokenHash: text("token_hash").notNull(),
    expiresAt: at("expires_at").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
    uses: integer("uses").notNull().default(0),
    lastUsedAt: at("last_used_at"),
    /** The rate limit: when the current minute began, and how many uses it has seen. */
    windowStartedAt: at("window_started_at"),
    windowUses: integer("window_uses").notNull().default(0),
  },
  (t) => [
    foreignKey({ name: "shift_check_links_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "shift_check_links_shift_fk", columns: [t.circleId, t.shiftId, t.memberId], foreignColumns: [shifts.circleId, shifts.id, shifts.memberId] }),
    foreignKey({ name: "shift_check_links_created_by_fk", columns: [t.circleId, t.createdBy], foreignColumns: [members.circleId, members.id] }),
    unique("shift_check_links_circle_row").on(t.circleId, t.id),
    unique("shift_check_links_token").on(t.tokenHash),
    index("shift_check_links_shift_idx").on(t.circleId, t.shiftId, t.expiresAt),
    check("shift_check_links_hash", sql`${t.tokenHash} ~ '^[0-9a-f]{64}$'`),
    check("shift_check_links_expiry", sql`${t.expiresAt} > ${t.createdAt}`),
    check("shift_check_links_counts", sql`${t.uses} >= 0 and ${t.windowUses} >= 0`),
  ],
);

/**
 * Whether Kin may phone the parent for the family's word, and where. The
 * number is a secret of the family's: it is in no snapshot, and no role of the
 * web app may read the column. Consent is recorded each time a call is switched
 * on, with who gave it and when. Quiet hours are in the circle's own time.
 */
export const parentCallSettings = pgTable(
  "parent_call_settings",
  {
    id: id(),
    circleId: circleId(),
    /** The circle's parent, whose word the call records. */
    memberId: uuid("member_id").notNull(),
    /** E.164: a plus sign, a country code and the number. */
    phone: text("phone").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** The language Kin speaks to her in. */
    locale: text("locale").notNull().default("en"),
    consentedBy: uuid("consented_by"),
    consentedAt: at("consented_at"),
    /** No call is placed from the start of the quiet hours until their end, on the circle's clock. */
    quietStart: time("quiet_start").notNull().default("21:00"),
    quietEnd: time("quiet_end").notNull().default("08:00"),
    updatedAt: at("updated_at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "parent_call_settings_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "parent_call_settings_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "parent_call_settings_consented_by_fk", columns: [t.circleId, t.consentedBy], foreignColumns: [members.circleId, members.id] }),
    unique("parent_call_settings_circle_row").on(t.circleId, t.id),
    unique("parent_call_settings_one_per_circle").on(t.circleId),
    check("parent_call_settings_phone", sql`${t.phone} ~ '^\\+[1-9][0-9]{6,14}$'`),
    check("parent_call_settings_locale", sql`${t.locale} ~ '^[a-z]{2}(-[A-Z]{2})?$'`),
    check("parent_call_settings_consent_whole", sql`(${t.consentedAt} is null) = (${t.consentedBy} is null)`),
    check("parent_call_settings_enabled_has_consent", sql`not ${t.enabled} or ${t.consentedAt} is not null`),
    check("parent_call_settings_quiet_hours", sql`${t.quietStart} <> ${t.quietEnd}`),
  ],
);

/**
 * One attempt of Kin's call to the parent about one shift. At most two a
 * shift, and one at a time. Its state moves along the diagram in
 * packages/domain, and the family's word it brings is written on the shift.
 */
export const shiftCalls = pgTable(
  "shift_calls",
  {
    id: id(),
    circleId: circleId(),
    shiftId: uuid("shift_id").notNull(),
    /** Which attempt this is, from one. */
    attempt: integer("attempt").notNull(),
    state: text("state").notNull().default("queued"),
    /** The telephony provider's ID for the call, once it is placed. It is the evidence of a word spoken on it. */
    callSid: text("call_sid"),
    /** A short reason the call did not happen. Never the number or what was said. */
    lastError: text("last_error"),
    createdAt: createdAt(),
    endedAt: at("ended_at"),
  },
  (t) => [
    foreignKey({ name: "shift_calls_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "shift_calls_shift_fk", columns: [t.circleId, t.shiftId], foreignColumns: [shifts.circleId, shifts.id] }),
    unique("shift_calls_circle_row").on(t.circleId, t.id),
    unique("shift_calls_attempt").on(t.circleId, t.shiftId, t.attempt),
    uniqueIndex("shift_calls_sid").on(t.circleId, t.callSid).where(sql`${t.callSid} is not null`),
    // One call at a time for a shift.
    uniqueIndex("shift_calls_one_active").on(t.circleId, t.shiftId).where(sql`${t.state} in ('queued', 'calling', 'answered')`),
    index("shift_calls_shift_idx").on(t.circleId, t.shiftId),
    check("shift_calls_state", sql.raw(`state in (${SHIFT_CALL_STATES.map((state) => `'${state}'`).join(", ")})`)),
    check("shift_calls_attempt_range", sql.raw(`attempt between 1 and ${MAX_SHIFT_CALL_ATTEMPTS}`)),
    check("shift_calls_sid_shape", sql`${t.callSid} is null or ${t.callSid} ~ '^[A-Za-z0-9]{1,64}$'`),
    check("shift_calls_error_short", sql`${t.lastError} is null or length(${t.lastError}) <= 200`),
    check("shift_calls_placed_has_sid", sql`${t.state} in ('queued', 'failed') or ${t.callSid} is not null`),
    check("shift_calls_ended_when_over", sql`(${t.state} in ('confirmed', 'declined', 'no_answer', 'failed')) = (${t.endedAt} is not null)`),
  ],
);
