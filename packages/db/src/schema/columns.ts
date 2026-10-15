import { sql } from "drizzle-orm";
import { bigint, char, timestamp, uuid } from "drizzle-orm/pg-core";

/** A row's own ID. Kin makes it, so a row can be referenced before it is written. */
export const id = () => uuid("id").primaryKey();

/** The circle a row belongs to. Every table but `users` has one. */
export const circleId = () => uuid("circle_id").notNull();

/** Integer cents. Never a float (AGENTS.md section 5). */
export const cents = (name: string) => bigint(name, { mode: "number" });

export const currency = () => char("currency", { length: 3 }).notNull();

export const at = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

export const createdAt = () => at("created_at").notNull().default(sql`now()`);

/** The SQL that checks a YYYY-MM period column. */
export const periodCheck = (column: string) => sql.raw(`${column} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`);
