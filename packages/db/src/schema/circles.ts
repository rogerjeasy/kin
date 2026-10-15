import { sql } from "drizzle-orm";
import { bigint, boolean, check, foreignKey, index, pgTable, text, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import { at, circleId, createdAt, currency, id } from "./columns.ts";
import { circleRole, circleStatus, invitationStatus, memberStatus, parentLevel, userKind } from "./enums.ts";

/** A person who has signed in. The ID is the identity provider's subject. */
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    kind: userKind("kind").notNull().default("person"),
    email: text("email").notNull(),
    /** Cognito confirmed the person owns the address. Invitations are matched only then. */
    emailVerified: boolean("email_verified").notNull().default(false),
    name: text("name").notNull(),
    /** The language Kin speaks and writes to this person in. */
    language: text("language").notNull().default("en"),
    paypalPayerId: text("paypal_payer_id"),
    createdAt: createdAt(),
    lastSeenAt: at("last_seen_at").notNull().default(sql`now()`),
  },
  (t) => [
    check("users_id_present", sql`length(${t.id}) between 1 and 128`),
    // A visitor's ID marks them as one, so no Cognito subject can pose as a visitor or the reverse.
    check("users_demo_visitor_id", sql`(${t.kind} = 'demo_visitor') = (${t.id} like 'demo:%')`),
  ],
);

/** A family caring for one parent, with the pool they share. */
export const circles = pgTable(
  "circles",
  {
    id: id(),
    name: text("name").notNull(),
    timezone: text("timezone").notNull(),
    currency: currency(),
    status: circleStatus("status").notNull().default("active"),
    /** A demo circle's money is simulated and is labelled so everywhere. */
    demo: boolean("demo").notNull().default(false),
    /** The demo clock: "now" for this circle. `null` means the real time. */
    clockAt: at("clock_at"),
    pausedUntil: at("paused_until"),
    /** The member who paused it. Its foreign key is in the row-level security migration. */
    pausedBy: uuid("paused_by"),
    /**
     * The transaction that wrote the circle. Row-level security lets the
     * provisioner fill a circle only inside the transaction that created it.
     */
    provisionedTxid: bigint("provisioned_txid", { mode: "number" }).notNull().default(sql`txid_current()`),
    createdAt: createdAt(),
  },
  (t) => [
    check("circles_name_present", sql`length(trim(${t.name})) > 0`),
    check("circles_currency_code", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("circles_clock_only_in_demo", sql`${t.clockAt} is null or ${t.demo}`),
    check("circles_pause_has_author", sql`(${t.pausedUntil} is null) = (${t.pausedBy} is null)`),
  ],
);

/** A person's place in one circle. The parent may take part without an account. */
export const members = pgTable(
  "members",
  {
    id: id(),
    circleId: circleId(),
    userId: text("user_id").references(() => users.id),
    displayName: text("display_name").notNull(),
    role: circleRole("role").notNull(),
    /** How the parent takes part. Set for the parent and nobody else. */
    parentLevel: parentLevel("parent_level"),
    /** How the member is related to the parent, in their own words. */
    relationship: text("relationship"),
    /** The key of a portrait the app knows, or `null` for initials. */
    portrait: text("portrait"),
    status: memberStatus("status").notNull().default("active"),
    /** The seat a visitor takes in their own demo circle. A person has one at a time. */
    demoSeat: boolean("demo_seat").notNull().default(false),
    joinedAt: at("joined_at").notNull().default(sql`now()`),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "members_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    unique("members_circle_row").on(t.circleId, t.id),
    unique("members_one_seat_per_person").on(t.circleId, t.userId),
    index("members_user_idx").on(t.userId),
    uniqueIndex("members_one_demo_seat").on(t.userId).where(sql`${t.demoSeat} and ${t.status} = 'active'`),
    check("members_demo_seat_has_person", sql`not ${t.demoSeat} or ${t.userId} is not null`),
    check("members_name_present", sql`length(trim(${t.displayName})) > 0`),
    check("members_parent_level_only_for_parent", sql`(${t.role} = 'parent') = (${t.parentLevel} is not null)`),
  ],
);

/** An invitation to join a circle in a given role. */
export const invitations = pgTable(
  "invitations",
  {
    id: id(),
    circleId: circleId(),
    email: text("email").notNull(),
    role: circleRole("role").notNull(),
    invitedBy: uuid("invited_by").notNull(),
    status: invitationStatus("status").notNull().default("pending"),
    expiresAt: at("expires_at").notNull(),
    answeredAt: at("answered_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "invitations_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "invitations_inviter_fk", columns: [t.circleId, t.invitedBy], foreignColumns: [members.circleId, members.id] }),
    check("invitations_email_shape", sql`${t.email} ~ '^[^@\\s]+@[^@\\s]+$'`),
  ],
);
