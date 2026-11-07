import {
  CIRCLE_ROLES,
  DIRECTIONS,
  ENTRY_KINDS,
  ENTRY_SOURCE_TYPES,
  MEMBER_STATUSES,
  PARENT_LEVELS,
  PROPOSAL_KINDS,
  BILL_TRANSITIONS,
  EXECUTION_TRANSITIONS,
  PROPOSAL_TRANSITIONS,
} from "@kin/domain";
import { pgEnum } from "drizzle-orm/pg-core";

import {
  APPROVAL_METHODS,
  AUDIT_ACTORS,
  CIRCLE_STATUSES,
  CLAIM_VERDICTS,
  DOCUMENT_KINDS,
  INVITATION_STATUSES,
  NARRATION_STATES,
  PAYEE_STATUSES,
  PAYPAL_EVENT_STATES,
  RECEIPT_STATES,
  SETTLEMENT_STATES,
  USER_KINDS,
  VOTE_DECISIONS,
} from "../values.ts";

/** A state machine's states, in the order its table lists them. */
function statesOf<T extends Record<string, unknown>>(table: T): [keyof T & string, ...(keyof T & string)[]] {
  const [first, ...rest] = Object.keys(table) as (keyof T & string)[];
  if (first === undefined) throw new Error("A state machine has no states");
  return [first, ...rest];
}

// Every enum is built from the constant the rest of Kin reads, so the database
// cannot know a role, kind or state that the code does not.
export const circleRole = pgEnum("circle_role", CIRCLE_ROLES);
export const parentLevel = pgEnum("parent_level", PARENT_LEVELS);
export const proposalKind = pgEnum("proposal_kind", PROPOSAL_KINDS);
export const proposalState = pgEnum("proposal_state", statesOf(PROPOSAL_TRANSITIONS));
export const billState = pgEnum("bill_state", statesOf(BILL_TRANSITIONS));
export const executionState = pgEnum("execution_state", statesOf(EXECUTION_TRANSITIONS));
export const entryKind = pgEnum("entry_kind", ENTRY_KINDS);
export const entrySourceType = pgEnum("entry_source_type", ENTRY_SOURCE_TYPES);
export const direction = pgEnum("direction", DIRECTIONS);

export const userKind = pgEnum("user_kind", USER_KINDS);
export const circleStatus = pgEnum("circle_status", CIRCLE_STATUSES);
export const memberStatus = pgEnum("member_status", MEMBER_STATUSES);
export const invitationStatus = pgEnum("invitation_status", INVITATION_STATUSES);
export const payeeStatus = pgEnum("payee_status", PAYEE_STATUSES);
export const voteDecision = pgEnum("vote_decision", VOTE_DECISIONS);
export const approvalMethod = pgEnum("approval_method", APPROVAL_METHODS);
export const documentKind = pgEnum("document_kind", DOCUMENT_KINDS);
export const receiptState = pgEnum("receipt_state", RECEIPT_STATES);
export const settlementState =pgEnum("settlement_state", SETTLEMENT_STATES);
export const claimVerdict = pgEnum("claim_verdict", CLAIM_VERDICTS);
export const narrationState = pgEnum("narration_state", NARRATION_STATES);
export const paypalEventState = pgEnum("paypal_event_state", PAYPAL_EVENT_STATES);
export const auditActor = pgEnum("audit_actor", AUDIT_ACTORS);
