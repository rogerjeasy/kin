import {
  answerPresenceCheckByCall,
  asService,
  openPresenceCheckByLine,
  readFamilyCodeSeed,
  readPresenceAskFacts,
  readPresenceLine,
  readPresenceLineCheck,
  type Database,
  type PresenceAskFacts,
  type PresenceCheckInput,
  type PresenceLine,
  type PresenceLineCheck,
  type PresenceOpened,
} from "@kin/db";

/**
 * What the "is it really you?" line needs from the database. It is defined
 * here, beside the code that needs it, so the line is tested and demonstrated
 * against an in-memory stand-in; `presenceLineStoreOn` is the real one. Every
 * operation acts as Kin's service for the one circle in its argument, and the
 * database refuses any other.
 */
export type PresenceLineStore = {
  /** The circle as the line may read it, or `null` when it is closed. */
  read(circleId: string): Promise<PresenceLine | null>;
  /** Records the parent's call as a check, once per call. A second delivery for the same call returns the first check. */
  open(input: PresenceCheckInput & { readonly callSid: string }): Promise<PresenceOpened>;
  /** How a check this line opened stands. */
  status(circleId: string, checkId: string): Promise<PresenceLineCheck | null>;
  /** The secret the weekly family code is worked out from, for the circle the dialled number belongs to. */
  familyCodeSeed(circleId: string): Promise<string>;
  /** Who a check is about and what it says, for Kin's call to the real person. `null` when the check is gone. */
  askFacts(circleId: string, checkId: string): Promise<PresenceAskFacts | null>;
  /** The real person's answer on Kin's call, held by the database to the very call it recorded for this check. */
  answerByCall(input: { readonly circleId: string; readonly checkId: string; readonly callSid: string; readonly answer: "me" | "not_me" }): Promise<{ readonly state: string; readonly changed: boolean }>;
};

export function presenceLineStoreOn(db: Database): PresenceLineStore {
  return {
    read: (circleId) => asService(db, circleId, (tx) => readPresenceLine(tx, circleId)),
    open: (input) => asService(db, input.circleId, (tx) => openPresenceCheckByLine(tx, input)),
    status: (circleId, checkId) => asService(db, circleId, (tx) => readPresenceLineCheck(tx, circleId, checkId)),
    familyCodeSeed: (circleId) => asService(db, circleId, (tx) => readFamilyCodeSeed(tx, circleId)),
    askFacts: (circleId, checkId) => asService(db, circleId, (tx) => readPresenceAskFacts(tx, circleId, checkId)),
    answerByCall: (input) => asService(db, input.circleId, (tx) => answerPresenceCheckByCall(tx, input)),
  };
}
