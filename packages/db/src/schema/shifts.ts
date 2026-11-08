import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { MAX_SHIFT_MINUTES, SHIFT_KINDS } from "@kin/domain";

import { at, cents, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { mandateStatus, shiftState } from "./enums.ts";
import { proposals } from "./approvals.ts";
import { payees } from "./payees.ts";

/**
 * One care shift on the circle's calendar: an aide's visit, a sibling's visit,
 * an appointment or a drive. Only an aide's shift is paid, and it is paid when
 * two independent keys turn: the caregiver's own check-in and check-out, and
 * the family's word. Its identity and every key, once turned, never change;
 * only the state moves, along the diagram in packages/domain.
 */
export const shifts = pgTable(
  "shifts",
  {
    id: id(),
    circleId: circleId(),
    kind: text("kind").notNull(),
    title: text("title"),
    /** The member who does the shift. */
    memberId: uuid("member_id").notNull(),
    /** Whom an aide's shift pays: the caregiver's payee row. Other kinds have none. */
    payeeId: uuid("payee_id"),
    startsAt: at("starts_at").notNull(),
    endsAt: at("ends_at").notNull(),
    state: shiftState("state").notNull().default("scheduled"),
    /** The caregiver's key, on the circle's clock. */
    checkedInAt: at("checked_in_at"),
    checkedOutAt: at("checked_out_at"),
    /** The family's key: whose word, when, and whether it was the parent's or a sibling's. */
    familyConfirmedBy: uuid("family_confirmed_by"),
    familyConfirmedAt: at("family_confirmed_at"),
    familyConfirmation: text("family_confirmation", { enum: ["parent", "sibling"] }),
    /** What proves the family's word when it was not given on a screen: the call's provider ID. Set with the word and fixed with it. */
    familyEvidenceRef: text("family_evidence_ref"),
    /** Set with the price, by the database: whole minutes between the two taps, and the minutes paid for. */
    workedMinutes: integer("worked_minutes"),
    billableMinutes: integer("billable_minutes"),
    rateCentsPerHour: cents("rate_cents_per_hour"),
    cents: cents("cents"),
    proposalId: uuid("proposal_id"),
    /** The standing permission that covered it, when one did. */
    permissionId: uuid("permission_id"),
    createdBy: uuid("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "shifts_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "shifts_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "shifts_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "shifts_confirmed_by_fk", columns: [t.circleId, t.familyConfirmedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "shifts_created_by_fk", columns: [t.circleId, t.createdBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "shifts_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    foreignKey({ name: "shifts_permission_fk", columns: [t.circleId, t.permissionId], foreignColumns: [shiftPermissions.circleId, shiftPermissions.id] }),
    unique("shifts_circle_row").on(t.circleId, t.id),
    // Lets a row that belongs to one shift's member say so, and the database hold it to that.
    unique("shifts_circle_row_member").on(t.circleId, t.id, t.memberId),
    unique("shifts_one_per_proposal").on(t.circleId, t.proposalId),
    index("shifts_starts_idx").on(t.circleId, t.startsAt),
    index("shifts_member_idx").on(t.circleId, t.memberId),
    check("shifts_kind", sql.raw(`kind in (${SHIFT_KINDS.map((kind) => `'${kind}'`).join(", ")})`)),
    check("shifts_title", sql`${t.title} is null or length(trim(${t.title})) between 1 and 120`),
    check("shifts_planned_span", sql`${t.endsAt} > ${t.startsAt} and ${t.endsAt} - ${t.startsAt} <= interval '24 hours'`),
    // An aide's shift pays a caregiver; nothing else on the calendar is paid.
    check("shifts_aide_has_payee", sql`(${t.kind} = 'aide') = (${t.payeeId} is not null)`),
    check("shifts_taps_in_order", sql`(${t.checkedOutAt} is null or (${t.checkedInAt} is not null and ${t.checkedOutAt} > ${t.checkedInAt}))`),
    check(
      "shifts_family_word_whole",
      sql`(${t.familyConfirmedAt} is null) = (${t.familyConfirmedBy} is null) and (${t.familyConfirmedAt} is null) = (${t.familyConfirmation} is null) and (${t.familyConfirmation} is null or ${t.familyConfirmation} in ('parent', 'sibling'))`,
    ),
    // The state says which keys have turned, and the keys say which state is possible.
    check(
      "shifts_state_matches_keys",
      sql`(${t.state} <> 'scheduled' or (${t.checkedInAt} is null and ${t.familyConfirmedAt} is null))
        and (${t.state} <> 'checked_in' or (${t.checkedInAt} is not null and ${t.checkedOutAt} is null))
        and (${t.state} <> 'checked_out' or (${t.checkedOutAt} is not null and ${t.familyConfirmedAt} is null))
        and (${t.state}::text not in ('confirmed', 'priced', 'paid', 'credited') or (${t.checkedOutAt} is not null and ${t.familyConfirmedAt} is not null))`,
    ),
    // Priced means the database worked out the price and a proposal carries it: nothing is paid on a shift without both.
    check(
      "shifts_priced_has_proposal",
      sql`(${t.state} in ('priced', 'paid')) = (${t.proposalId} is not null and ${t.cents} is not null and ${t.workedMinutes} is not null and ${t.billableMinutes} is not null and ${t.rateCentsPerHour} is not null)`,
    ),
    check("shifts_evidence_with_word", sql`${t.familyEvidenceRef} is null or (${t.familyConfirmedAt} is not null and length(${t.familyEvidenceRef}) between 1 and 100)`),
    check("shifts_permission_needs_proposal", sql`${t.permissionId} is null or ${t.proposalId} is not null`),
    check(
      "shifts_price_in_range",
      sql.raw(
        `(cents is null or (cents > 0 and cents <= 9007199254740991)) and (rate_cents_per_hour is null or rate_cents_per_hour > 0) and (worked_minutes is null or worked_minutes between 1 and ${MAX_SHIFT_MINUTES}) and (billable_minutes is null or billable_minutes between worked_minutes and ${MAX_SHIFT_MINUTES})`,
      ),
    ),
  ],
);

/**
 * The parent's standing permission to pay one caregiver's confirmed shifts:
 * up to some hours a day and some amount a shift, between two dates. Its terms
 * are fixed once granted; only its status moves, and a revoked permission never
 * returns. Like a mandate, the database seals the terms with a digest.
 */
export const shiftPermissions = pgTable(
  "shift_permissions",
  {
    id: id(),
    circleId: circleId(),
    /** The caregiver's payee row it covers. */
    payeeId: uuid("payee_id").notNull(),
    /** The parent whose permission it is. */
    grantedBy: uuid("granted_by").notNull(),
    /** Who recorded it: the parent, or in a demo circle the organizer playing the parent's spoken yes. */
    recordedBy: uuid("recorded_by").notNull(),
    maxMinutesPerDay: integer("max_minutes_per_day").notNull(),
    perShiftCents: cents("per_shift_cents").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    expiresOn: date("expires_on", { mode: "string" }).notNull(),
    status: mandateStatus("status").notNull().default("active"),
    /** The words the parent spoke, as written down, or `null` when she used the screen. */
    spokenText: text("spoken_text"),
    /** What proves the grant: the call, or the demo's stand-in. */
    evidenceRef: text("evidence_ref").notNull(),
    /** A grant made in a demo circle is simulated, and shown so. */
    simulated: boolean("simulated").notNull(),
    /** SHA-256 of the canonical terms, computed by the database when it was granted. */
    digest: text("digest").notNull(),
    grantedAt: at("granted_at").notNull(),
    endedAt: at("ended_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "shift_permissions_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "shift_permissions_payee_fk", columns: [t.circleId, t.payeeId], foreignColumns: [payees.circleId, payees.id] }),
    foreignKey({ name: "shift_permissions_granted_by_fk", columns: [t.circleId, t.grantedBy], foreignColumns: [members.circleId, members.id] }),
    foreignKey({ name: "shift_permissions_recorded_by_fk", columns: [t.circleId, t.recordedBy], foreignColumns: [members.circleId, members.id] }),
    unique("shift_permissions_circle_row").on(t.circleId, t.id),
    index("shift_permissions_payee_idx").on(t.circleId, t.payeeId),
    check("shift_permissions_caps", sql.raw(`per_shift_cents > 0 and per_shift_cents <= 9007199254740991 and max_minutes_per_day between 1 and ${MAX_SHIFT_MINUTES}`)),
    check("shift_permissions_dates", sql`${t.expiresOn} > ${t.validFrom} and ${t.expiresOn} - ${t.validFrom} <= 366`),
    check("shift_permissions_ended_when_revoked", sql`(${t.status} = 'revoked') = (${t.endedAt} is not null)`),
  ],
);

/**
 * One shift paid under a permission: which proposal, how many minutes and
 * what it cost, on which calendar day. The day's total is what the next shift
 * is checked against.
 */
export const shiftPermissionUses = pgTable(
  "shift_permission_uses",
  {
    id: id(),
    circleId: circleId(),
    permissionId: uuid("permission_id").notNull(),
    shiftId: uuid("shift_id").notNull(),
    proposalId: uuid("proposal_id").notNull(),
    cents: cents("cents").notNull(),
    /** The minutes paid for, which count toward the permission's daily hours. */
    minutes: integer("minutes").notNull(),
    /** The circle's calendar day the shift began on. */
    day: date("day", { mode: "string" }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "shift_permission_uses_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "shift_permission_uses_permission_fk", columns: [t.circleId, t.permissionId], foreignColumns: [shiftPermissions.circleId, shiftPermissions.id] }),
    foreignKey({ name: "shift_permission_uses_shift_fk", columns: [t.circleId, t.shiftId], foreignColumns: [shifts.circleId, shifts.id] }),
    foreignKey({ name: "shift_permission_uses_proposal_fk", columns: [t.circleId, t.proposalId], foreignColumns: [proposals.circleId, proposals.id] }),
    unique("shift_permission_uses_circle_row").on(t.circleId, t.id),
    unique("shift_permission_uses_one_per_proposal").on(t.circleId, t.proposalId),
    unique("shift_permission_uses_one_per_shift").on(t.circleId, t.shiftId),
    index("shift_permission_uses_day_idx").on(t.circleId, t.permissionId, t.day),
    check("shift_permission_uses_amounts", sql.raw(`cents > 0 and minutes between 1 and ${MAX_SHIFT_MINUTES}`)),
  ],
);
