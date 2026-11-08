import { authorize, type CircleAction } from "@kin/auth";
import {
  ShiftCallError,
  ShiftError,
  asPerson,
  cancelShift,
  checkInShift,
  checkOutShift,
  confirmShift,
  grantShiftPermission,
  newShiftId,
  scheduleShift,
  setOwnPayoutTarget,
  setShiftPermissionStatus,
  setShiftRules,
  type CircleSnapshot,
  type Database,
  type ShiftCallReason,
  type ShiftReason,
  type ShiftTurn,
} from "@kin/db";
import { ShiftPermissionTermsError, checkShiftPermissionTerms, shiftPermissionExcessAboveParentLimit, type ShiftPermissionRefusal, type ShiftPermissionTerms } from "@kin/domain";

import { parentDecision } from "./mandates";
import { familyWordRefusal } from "./shift-access";
import { setCallSettings, callSettingsRequest, mayEnableCall } from "./shift-call-settings";
import { simulatedCall, type SimulatedCall } from "./shift-call-simulation";
import { linkRequest, makeCheckLink, type LinkFailure, type LinkServices, type MadeLink } from "./shift-links";
import { MAX_SPOKEN_CHARS, onlyKeys, permissionDraft, record, rulesDraft, scheduleDraft, targetDraft, uuidField, type ShiftInputFailure } from "./shift-input";

export type ShiftContext = {
  readonly db: Database;
  readonly userId: string;
  readonly circle: CircleSnapshot;
  /** Where links point and whether they can be texted. Without it a link cannot be made. */
  readonly links?: LinkServices;
};
export type ShiftFailure = ShiftReason | ShiftCallReason | LinkFailure | ShiftInputFailure | "unavailable";

/** What a turn of a key brought about, for the screen to word. The amounts are the database's, never the browser's. */
export type ShiftOutcome =
  | { readonly kind: "paid_by_permission"; readonly cents: number }
  | { readonly kind: "asks_family"; readonly cents: number; readonly askReason: ShiftPermissionRefusal | null }
  /** A key is still missing, so nothing is priced yet. */
  | { readonly kind: "waiting" }
  /** Both keys turned, but the shift cannot be settled yet (a paused circle, no agreement...). */
  | { readonly kind: "held"; readonly reason: ShiftReason };

export type ShiftResult =
  | { readonly ok: true; readonly outcome: ShiftOutcome }
  /** `aboveUsualCents`: how far the per-shift cap passes what the parent usually decides herself, 0 when it does not. */
  | { readonly ok: true; readonly terms: ShiftPermissionTerms; readonly aboveUsualCents: number }
  | { readonly ok: true; readonly id: string }
  /** A check-in link, shown this once. */
  | { readonly ok: true; readonly link: MadeLink }
  /** What Kin says on its call about a visit, for a demo circle to hear. */
  | { readonly ok: true; readonly call: SimulatedCall }
  | { readonly ok: false; readonly reason: ShiftFailure };

const PERMISSION_STATUS = { pause_permission: "paused", resume_permission: "active", revoke_permission: "revoked" } as const;
const SHIFT_ACTIONS = { check_in: "shift.check", check_out: "shift.check", confirm: "shift.confirm", cancel: "shift.cancel" } as const satisfies Record<string, CircleAction>;

const refusal = (reason: ShiftFailure): ShiftResult => ({ ok: false, reason });
const done = (id: string): ShiftResult => ({ ok: true, id });

/**
 * The one request boundary for care shifts: scheduling one, the caregiver's two
 * taps, the family's word, calling one off, the caregivers' pay rules, where a
 * caregiver's own pay goes, and the parent's standing permission to pay
 * confirmed shifts. The browser sends words, whole numbers and decimals only.
 * Each operation is allowed by the access table first, every field is read
 * again here, and the amounts and hours are checked by plain code in
 * `packages/domain` and again by the database. A shift is priced and paid from
 * its own taps, never from anything the browser says.
 */
export async function runShift(context: ShiftContext, input: unknown): Promise<ShiftResult> {
  const row = record(input);
  if (row === null || typeof row["operation"] !== "string") return refusal("invalid");
  const operation = row["operation"];
  const seat = { role: context.circle.viewer.role, status: "active" as const };
  const allowed = (action: CircleAction) => authorize(seat, action).allowed;
  try {
    if (operation === "schedule") return allowed("shift.schedule") ? await schedule(context, row) : refusal("refused");
    if (Object.hasOwn(SHIFT_ACTIONS, operation)) {
      const turn = operation as keyof typeof SHIFT_ACTIONS;
      return allowed(SHIFT_ACTIONS[turn]) ? await turnKey(context, row, turn) : refusal("refused");
    }
    if (operation === "rules") return allowed("shift_rules.manage") ? await rules(context, row) : refusal("refused");
    if (operation === "target") return allowed("payout_target.set") ? await target(context, row) : refusal("refused");
    if (operation === "review_permission" || operation === "grant_permission") return allowed("shift_permission.grant") ? await permission(context, row, operation) : refusal("refused");
    if (Object.hasOwn(PERMISSION_STATUS, operation)) {
      const move = operation as keyof typeof PERMISSION_STATUS;
      return allowed(move === "pause_permission" ? "shift_permission.pause" : "shift_permission.grant") ? await permissionStatus(context, row, move) : refusal("refused");
    }
    if (operation === "check_link") return allowed("shift.link") ? await checkLink(context, row) : refusal("refused");
    if (operation === "call_settings") return await callSettings(context, row, allowed);
    if (operation === "call_script") return allowed("shift.confirm") ? simulatedCall(context.circle, row["shiftId"], row["locale"]) : refusal("refused");
    return refusal("invalid");
  } catch (error) {
    if (error instanceof ShiftPermissionTermsError || error instanceof ShiftError || error instanceof ShiftCallError) return refusal(error.reason);
    throw error;
  }
}

async function schedule(context: ShiftContext, row: Record<string, unknown>): Promise<ShiftResult> {
  if (!onlyKeys(row, ["operation", "id", "kind", "memberId", "title", "date", "start", "end"])) return refusal("invalid");
  const draft = scheduleDraft(context.circle, row);
  if (!draft.ok) return refusal(draft.reason);
  // The form's own request ID makes a double tap schedule once.
  const id = row["id"] === undefined ? newShiftId() : uuidField(row["id"]);
  if (id === null) return refusal("invalid");
  await asPerson(context.db, context.userId, (tx) => scheduleShift(tx, { circleId: context.circle.circle.id, id, ...draft.value }));
  return done(id);
}

async function checkLink(context: ShiftContext, row: Record<string, unknown>): Promise<ShiftResult> {
  const request = linkRequest(row);
  if (!("shiftId" in request)) return request;
  if (context.links === undefined) return refusal("unavailable");
  return makeCheckLink(context, request, context.links);
}

/** The parent's call: on with a number and her agreement, or off by anyone who answers for the family. */
async function callSettings(context: ShiftContext, row: Record<string, unknown>, allowed: (action: CircleAction) => boolean): Promise<ShiftResult> {
  const request = callSettingsRequest(row);
  if ("ok" in request) return request;
  if (!allowed(request.enabled ? "shift_call.manage" : "shift_call.stop") || (request.enabled && !mayEnableCall(context.circle))) return refusal("refused");
  await setCallSettings(context, request);
  return done(context.circle.parentCallSettings?.memberId ?? context.circle.viewer.memberId);
}

async function turnKey(context: ShiftContext, row: Record<string, unknown>, turn: keyof typeof SHIFT_ACTIONS): Promise<ShiftResult> {
  if (!onlyKeys(row, ["operation", "shiftId"])) return refusal("invalid");
  const shiftId = uuidField(row["shiftId"]);
  // A shift the viewer cannot read is not theirs to turn: the database hides it, so this one says the same.
  const shift = context.circle.shifts.find((each) => each.id === shiftId);
  if (shiftId === null || shift === undefined) return refusal(shiftId === null ? "invalid" : "refused");
  const circleId = context.circle.circle.id;
  const now = context.circle.circle.now;
  if (turn === "confirm") {
    const why = familyWordRefusal(context.circle, shift);
    if (why !== null) return refusal(why === "role_cannot" ? "refused" : why);
  }
  return asPerson(context.db, context.userId, async (tx): Promise<ShiftResult> => {
    if (turn === "check_in") return checkInShift(tx, { circleId, shiftId }).then(() => done(shiftId));
    if (turn === "cancel") return cancelShift(tx, { circleId, shiftId }).then(() => done(shiftId));
    const result = turn === "check_out" ? await checkOutShift(tx, { circleId, shiftId, now }) : await confirmShift(tx, { circleId, shiftId, now });
    return { ok: true, outcome: outcomeOf(result) };
  });
}

function outcomeOf(turn: ShiftTurn): ShiftOutcome {
  if (turn.settled) {
    const { outcome, cents, askReason } = turn.settled;
    return outcome === "paid_by_permission" ? { kind: "paid_by_permission", cents } : { kind: "asks_family", cents, askReason };
  }
  return turn.held === null ? { kind: "waiting" } : { kind: "held", reason: turn.held };
}

async function rules(context: ShiftContext, row: Record<string, unknown>): Promise<ShiftResult> {
  if (!onlyKeys(row, ["operation", "payeeId", "minimumMinutes", "overtimeAfterHours", "overtimePercent"])) return refusal("invalid");
  const draft = rulesDraft(context.circle, row);
  if (!draft.ok) return refusal(draft.reason);
  await asPerson(context.db, context.userId, (tx) => setShiftRules(tx, { circleId: context.circle.circle.id, ...draft.value }));
  return done(draft.value.payeeId);
}

async function target(context: ShiftContext, row: Record<string, unknown>): Promise<ShiftResult> {
  if (!onlyKeys(row, ["operation", "wallet", "receiver"])) return refusal("invalid");
  const draft = targetDraft(row);
  if (!draft.ok) return refusal(draft.reason === "invalid" ? "invalid_target" : draft.reason);
  await asPerson(context.db, context.userId, (tx) => setOwnPayoutTarget(tx, { circleId: context.circle.circle.id, ...draft.value }));
  return { ok: true, id: context.circle.viewer.memberId };
}

/** The parent reviews the terms Kin will read back, then grants them. Nothing is stored by the review. */
async function permission(context: ShiftContext, row: Record<string, unknown>, operation: "review_permission" | "grant_permission"): Promise<ShiftResult> {
  if (!onlyKeys(row, ["operation", "draft", "spokenText"]) || (operation === "review_permission" && row["spokenText"] !== undefined)) return refusal("invalid");
  const draft = permissionDraft(context.circle, row["draft"]);
  if (!draft.ok) return refusal(draft.reason);
  const ceiling = context.circle.agreement?.approvals.ceilingCents;
  if (ceiling === undefined) return refusal("no_agreement");
  checkShiftPermissionTerms(draft.value, ceiling);
  if (operation === "review_permission") return { ok: true, terms: draft.value, aboveUsualCents: excessAboveUsualLimit(context.circle, draft.value) };
  const spoken = row["spokenText"];
  if (spoken !== undefined && (typeof spoken !== "string" || spoken.length > MAX_SPOKEN_CHARS)) return refusal("invalid");
  const id = newShiftId();
  await asPerson(context.db, context.userId, (tx) =>
    grantShiftPermission(tx, { circleId: context.circle.circle.id, id, terms: draft.value, spokenText: typeof spoken === "string" ? spoken : null, now: context.circle.circle.now }),
  );
  return done(id);
}

async function permissionStatus(context: ShiftContext, row: Record<string, unknown>, move: keyof typeof PERMISSION_STATUS): Promise<ShiftResult> {
  const permissionId = uuidField(row["permissionId"]);
  if (!onlyKeys(row, ["operation", "permissionId"]) || permissionId === null) return refusal("invalid");
  await asPerson(context.db, context.userId, (tx) => setShiftPermissionStatus(tx, { circleId: context.circle.circle.id, permissionId, status: PERMISSION_STATUS[move] }));
  return done(permissionId);
}

/** How far a permission's per-shift cap passes what the parent usually decides herself, by the approval plan's own rule. */
export function excessAboveUsualLimit(circle: CircleSnapshot, terms: ShiftPermissionTerms): number {
  const decision = parentDecision(circle);
  return decision ? shiftPermissionExcessAboveParentLimit(terms, decision.level, decision.approvals) : 0;
}
