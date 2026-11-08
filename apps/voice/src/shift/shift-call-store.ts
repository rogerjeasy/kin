import {
  asService,
  openShiftCallForWebhook,
  recordCallStatus,
  recordFamilyWordByCall,
  type CallReport,
  type Database,
  type FamilyWordByCall,
  type ShiftCallWebhookRecord,
} from "@kin/db";

/** Which attempt of which shift's call a webhook is about, in which circle. Only a verified token names a circle. */
export type ShiftCallRef = { readonly circleId: string; readonly shiftId: string };

/**
 * What the shift call's webhooks need from the database. It is defined here, beside the code that needs it, so
 * the service is tested and demonstrated against an in-memory stand-in; `shiftCallStoreOn` is the real one.
 * Every operation acts as Kin's service for the one circle in its argument, and the database refuses any other.
 */
export type ShiftCallStore = {
  /**
   * Ties the request's `callSid` to the attempt and loads what the call says. `null` when the call is not Kin's for this
   * shift and attempt. Binds an attempt still waiting for its ID to this one, since Twilio's request can beat the worker's record.
   */
  open(input: ShiftCallRef & { readonly attempt: number; readonly callSid: string }): Promise<ShiftCallWebhookRecord | null>;
  /** The parent picked up. Said again, it changes nothing. */
  markAnswered(input: ShiftCallRef & { readonly callSid: string }): Promise<void>;
  /** Records a clear yes or no as the parent's word. Said again, it changes nothing. Refused with a typed error when the database will not take it. */
  recordWord(input: ShiftCallRef & { readonly callSid: string; readonly answer: "yes" | "no" }): Promise<FamilyWordByCall>;
  /** How the call ended with no word. A call already over stays as it is. */
  reportEnd(input: ShiftCallRef & { readonly callSid: string; readonly status: Exclude<CallReport, "answered">; readonly error?: string }): Promise<void>;
};

export function shiftCallStoreOn(db: Database): ShiftCallStore {
  return {
    open: (input) => asService(db, input.circleId, (tx) => openShiftCallForWebhook(tx, input)),
    markAnswered: async (input) => {
      await asService(db, input.circleId, (tx) => recordCallStatus(tx, { ...input, status: "answered" }));
    },
    recordWord: (input) => asService(db, input.circleId, (tx) => recordFamilyWordByCall(tx, input)),
    reportEnd: async (input) => {
      await asService(db, input.circleId, (tx) => recordCallStatus(tx, input));
    },
  };
}
