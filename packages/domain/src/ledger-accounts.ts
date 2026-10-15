import { LedgerError } from "./ledger-error.ts";

export const DIRECTIONS = ["debit", "credit"] as const;

export type Direction = (typeof DIRECTIONS)[number];
export type AccountType = "asset" | "liability" | "equity" | "expense" | "memo";

type AccountFamily = {
  readonly type: AccountType;
  /** The side on which the account's balance grows. */
  readonly normal: Direction;
  /** A scoped account names its member, payee or category after a colon. */
  readonly scoped: boolean;
};

/**
 * The accounts of a circle, from docs/architecture.md section 7.1. Memo
 * accounts hold valued care hours beside the cash ledger and never mix with it.
 */
const ACCOUNT_FAMILIES = {
  pool_cash: { type: "asset", normal: "debit", scoped: false },
  pool_clearing: { type: "asset", normal: "debit", scoped: false },
  fees: { type: "expense", normal: "debit", scoped: false },
  expense: { type: "expense", normal: "debit", scoped: true },
  payable: { type: "liability", normal: "credit", scoped: true },
  member: { type: "equity", normal: "credit", scoped: true },
  care_credit: { type: "memo", normal: "credit", scoped: true },
  care_received: { type: "memo", normal: "debit", scoped: false },
} as const satisfies Record<string, AccountFamily>;

type FamilyName = keyof typeof ACCOUNT_FAMILIES;
type ScopedFamily = {
  [Name in FamilyName]: (typeof ACCOUNT_FAMILIES)[Name]["scoped"] extends true
    ? Name
    : never;
}[FamilyName];

export type AccountCode =
  | Exclude<FamilyName, ScopedFamily>
  | `${ScopedFamily}:${string}`;

export const POOL_CASH: AccountCode = "pool_cash";
export const POOL_CLEARING: AccountCode = "pool_clearing";
export const FEES: AccountCode = "fees";
export const CARE_RECEIVED: AccountCode = "care_received";

export function memberAccount(memberId: string): AccountCode {
  return `member:${memberId}`;
}

export function expenseAccount(category: string): AccountCode {
  return `expense:${category}`;
}

export function payableAccount(payeeId: string): AccountCode {
  return `payable:${payeeId}`;
}

export function careCreditAccount(memberId: string): AccountCode {
  return `care_credit:${memberId}`;
}

const SUBJECT = /^[A-Za-z0-9_-]+$/;

export type AccountDetails = AccountFamily & {
  readonly family: FamilyName;
  /** The member, payee or category of a scoped account, otherwise `null`. */
  readonly subject: string | null;
};

/** Reads an account code, and refuses one the ledger does not know. */
export function describeAccount(code: string): AccountDetails {
  const colon = code.indexOf(":");
  const name = colon === -1 ? code : code.slice(0, colon);
  const subject = colon === -1 ? null : code.slice(colon + 1);
  if (!isFamilyName(name)) {
    throw new LedgerError(
      "unknown_account",
      `Unknown ledger account "${code}"`,
    );
  }
  const family: AccountFamily = ACCOUNT_FAMILIES[name];
  const wellFormed = family.scoped
    ? subject !== null && SUBJECT.test(subject)
    : subject === null;
  if (!wellFormed) {
    throw new LedgerError(
      "unknown_account",
      `Malformed ledger account "${code}"`,
    );
  }
  return { ...family, family: name, subject };
}

function isFamilyName(name: string): name is FamilyName {
  return Object.hasOwn(ACCOUNT_FAMILIES, name);
}
