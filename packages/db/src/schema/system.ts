import { sql } from "drizzle-orm";
import { bigint, check, foreignKey, index, integer, jsonb, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { at, circleId, createdAt, id } from "./columns.ts";
import { circles, members } from "./circles.ts";
import { auditActor, paypalEventState } from "./enums.ts";

/**
 * Every webhook PayPal sent, stored raw before anything reads it, so a
 * signature can be checked again and an event replayed.
 */
export const paypalEvents = pgTable(
  "paypal_events",
  {
    id: id(),
    circleId: circleId(),
    /** PayPal's own event ID. PayPal retries, so it is unique. */
    eventId: text("event_id").notNull(),
    eventType: text("event_type").notNull(),
    rawBody: text("raw_body").notNull(),
    headers: jsonb("headers").notNull(),
    state: paypalEventState("state").notNull().default("received"),
    receivedAt: at("received_at").notNull().default(sql`now()`),
    processedAt: at("processed_at"),
  },
  (t) => [
    foreignKey({ name: "paypal_events_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    unique("paypal_events_once").on(t.eventId),
  ],
);

/** Messages written in the same transaction as the change that causes them. */
export const outbox = pgTable(
  "outbox",
  {
    id: id(),
    circleId: circleId(),
    topic: text("topic").notNull(),
    payload: jsonb("payload").notNull(),
    attempts: integer("attempts").notNull().default(0),
    availableAt: at("available_at").notNull().default(sql`now()`),
    sentAt: at("sent_at"),
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({ name: "outbox_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    index("outbox_unsent_idx").on(t.availableAt).where(sql`${t.sentAt} is null`),
    check("outbox_attempts", sql`${t.attempts} >= 0`),
  ],
);

/** Who did what, when and from where. Append-only. */
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    circleId: circleId(),
    sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull(),
    actor: auditActor("actor").notNull(),
    memberId: uuid("member_id"),
    action: text("action").notNull(),
    subjectType: text("subject_type"),
    subjectId: uuid("subject_id"),
    details: jsonb("details").notNull().default(sql`'{}'::jsonb`),
    /** Where the action came from: a request ID, a job, a call. */
    origin: text("origin"),
    at: at("at").notNull().default(sql`now()`),
  },
  (t) => [
    foreignKey({ name: "audit_log_circle_fk", columns: [t.circleId], foreignColumns: [circles.id] }),
    foreignKey({ name: "audit_log_member_fk", columns: [t.circleId, t.memberId], foreignColumns: [members.circleId, members.id] }),
    index("audit_log_circle_idx").on(t.circleId, t.sequence),
    check("audit_log_member_actor", sql`(${t.actor} = 'member') = (${t.memberId} is not null)`),
    check("audit_log_action_key", sql`${t.action} ~ '^[a-z_.]+$'`),
  ],
);
