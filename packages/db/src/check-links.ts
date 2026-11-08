import type { ShiftKind, ShiftState } from "@kin/domain";
import { sql } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import { postgresError, requiredId } from "./caregiver-billing.ts";
import type { Database, Transaction } from "./connection.ts";
import { callOperation } from "./shift-call-errors.ts";
import { ShiftError } from "./shift-errors.ts";

/**
 * No-login check-in links. The caregiver taps a link (from a text, a printed
 * QR code or an NFC tag at the door) and turns their own key on one shift.
 * The link is a bearer token the web app makes and shows once: the database
 * stores only its SHA-256, so a leaked table gives nobody a way in.
 */

/** A new link token: 32 random bytes as base64url, which is 43 characters. */
export const newCheckToken = (): string => randomBytes(32).toString("base64url");

/** The SHA-256 of a token in lowercase hex, which is all the database ever holds of it. */
export const hashCheckToken = (token: string): string => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Makes a link for a shift, from the hash of a token the caller made with
 * `newCheckToken`, and returns the link's ID. The shift's own member, an
 * organizer, a contributor or the parent may; the link must expire between
 * now and six hours after the shift was planned to end, and a shift has at most
 * five live ones. Sending the same hash for the same shift again returns the
 * link made. Run as the person, inside `asPerson`.
 */
export async function mintCheckLink(
  tx: Transaction,
  input: { readonly circleId: string; readonly shiftId: string; readonly tokenHash: string; readonly expiresAt: Date },
): Promise<string> {
  const result = await callOperation(() =>
    tx.execute<{ id: string }>(sql`select kin_private.mint_check_link(
      ${input.circleId}::uuid, ${input.shiftId}::uuid, ${input.tokenHash}, ${input.expiresAt.toISOString()}::timestamptz) as id`),
  );
  return requiredId(result.rows[0]?.id);
}

export type CheckLinkAction = "in" | "out";

/** What the public page may say after a tap: the shift, and whose key turned. */
export type CheckLinkResult = {
  readonly shiftId: string;
  readonly circleId: string;
  readonly kind: ShiftKind;
  readonly state: ShiftState;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly checkedInAt: Date | null;
  readonly checkedOutAt: Date | null;
  readonly memberFirstName: string;
  /** The circle's IANA time zone, the clock the planned times are told on. */
  readonly timezone: string;
  /** The family's word is already in, so a check-out confirms the shift. */
  readonly familyWordIn: boolean;
  readonly action: CheckLinkAction;
  /** This tap turned the key; `false` when the key had already turned and nothing changed. */
  readonly turned: boolean;
};

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function parseResult(raw: unknown): CheckLinkResult {
  if (!isObject(raw)) throw new Error("The check-in link returned no shift");
  const text = (key: string): string => {
    const found = raw[key];
    if (typeof found !== "string") throw new Error(`The check-in link's ${key} is not text`);
    return found;
  };
  const when = (key: string): Date | null => {
    const found = raw[key];
    return found === null || found === undefined ? null : new Date(text(key));
  };
  const action = text("action");
  if (action !== "in" && action !== "out") throw new Error("The check-in link returned an unknown action");
  return {
    shiftId: text("shiftId"),
    circleId: text("circleId"),
    // Safe: a check constraint holds the kind to the domain's list, and the enum holds the state to the domain's.
    kind: text("kind") as ShiftKind,
    state: text("state") as ShiftState,
    startsAt: new Date(text("startsAt")),
    endsAt: new Date(text("endsAt")),
    checkedInAt: when("checkedInAt"),
    checkedOutAt: when("checkedOutAt"),
    memberFirstName: text("memberFirstName"),
    timezone: text("timezone"),
    familyWordIn: raw["familyWordIn"] === true,
    action,
    turned: raw["turned"] === true,
  };
}

/**
 * Taps a link: checks the shift in or out for the link's member, exactly as
 * their own signed-in check-in or check-out would, on the circle's clock. Runs
 * with nobody signed in, as the app's own role, in a plain transaction.
 *
 * A token that is malformed, unknown, expired, for a cancelled shift or used
 * too often is refused as `ShiftError("refused")` and nothing more, so a refusal
 * never says whether the token exists. A real link whose shift is not in a state
 * for the tap is refused with the usual reason (`not_started`, `visit_too_short`,
 * `wrong_state`...). A check-out that confirms an aide's shift queues its settling
 * for the worker (`SHIFT_SETTLE_TOPIC`) in the same transaction.
 */
export async function useCheckLink(db: Database, input: { readonly token: string; readonly action: CheckLinkAction }): Promise<CheckLinkResult> {
  try {
    return await db.transaction(async (tx) => {
      const result = await callOperation(() => tx.execute<{ result: unknown }>(sql`select kin_private.use_check_link(${input.token}, ${input.action}) as result`));
      return parseResult(result.rows[0]?.result);
    });
  } catch (error) {
    // A token the database cannot even compare (not text it can store) is just as unknown.
    if (!(error instanceof ShiftError) && postgresError(error)?.code === "22021") throw new ShiftError("refused");
    throw error;
  }
}

/** Which key fits where the visit is: the first, the second, or neither because both have turned. */
export type CheckLinkNext = "in" | "out" | "done";

/** What the public page may say before any tap. No ID of the shift or the circle, and nothing about money. */
export type CheckLinkStatus = {
  readonly kind: ShiftKind;
  readonly state: ShiftState;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly memberFirstName: string;
  /** The circle's IANA time zone, the clock the planned times are told on. */
  readonly timezone: string;
  readonly familyWordIn: boolean;
  readonly next: CheckLinkNext;
};

function parseStatus(raw: unknown): CheckLinkStatus {
  if (!isObject(raw)) throw new Error("The check-in link returned no shift");
  const text = (key: string): string => {
    const found = raw[key];
    if (typeof found !== "string") throw new Error(`The check-in link's ${key} is not text`);
    return found;
  };
  const next = text("next");
  if (next !== "in" && next !== "out" && next !== "done") throw new Error("The check-in link returned an unknown next key");
  return {
    // Safe: a check constraint holds the kind to the domain's list, and the enum holds the state to the domain's.
    kind: text("kind") as ShiftKind,
    state: text("state") as ShiftState,
    startsAt: new Date(text("startsAt")),
    endsAt: new Date(text("endsAt")),
    memberFirstName: text("memberFirstName"),
    timezone: text("timezone"),
    familyWordIn: raw["familyWordIn"] === true,
    next,
  };
}

/**
 * Looks at a link without using it, so the public page can name the caregiver,
 * give the planned time and offer the one key that fits before anything is
 * tapped. It changes nothing: no use is counted and nothing is audited. Runs
 * with nobody signed in, as the app's own role, in a plain transaction.
 *
 * A token that is malformed, unknown, expired or for a cancelled shift is
 * refused as `ShiftError("refused")` and nothing more, exactly as `useCheckLink`
 * refuses it. The database holds no count of reads (its comment says why), so
 * the caller must throttle them per address.
 */
export async function readCheckLink(db: Database, input: { readonly token: string }): Promise<CheckLinkStatus> {
  try {
    return await db.transaction(async (tx) => {
      const result = await callOperation(() => tx.execute<{ result: unknown }>(sql`select kin_private.check_link_status(${input.token}) as result`));
      return parseStatus(result.rows[0]?.result);
    });
  } catch (error) {
    // A token the database cannot even compare (not text it can store) is just as unknown.
    if (!(error instanceof ShiftError) && postgresError(error)?.code === "22021") throw new ShiftError("refused");
    throw error;
  }
}
