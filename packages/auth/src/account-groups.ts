import type { CircleRole } from "@kin/domain";

import type { AccountType } from "./account-types.ts";

/** The account type every person who signs up holds. */
export const DEFAULT_ACCOUNT_TYPE = "family_member" satisfies AccountType;

/**
 * The only account types Kin itself ever grants. A professional or an
 * administrator is made by a person in the identity provider's console, never
 * by anything a person can do in Kin.
 */
export const GRANTABLE_ACCOUNT_TYPES = ["family_member", "caregiver"] as const satisfies readonly AccountType[];

export type GrantableAccountType = (typeof GRANTABLE_ACCOUNT_TYPES)[number];

/** One of the person's seats: the role they hold and whether the circle is a demo. */
export type HeldSeat = { readonly role: CircleRole; readonly demo: boolean };

/**
 * The account types a person is owed and does not hold yet: the default one,
 * which every sign-up gets (and accounts made before that rule lacked), and
 * caregiver once they hold a caregiver's seat in a real circle, which only an
 * organizer's invitation gives. A demo seat proves nothing about a person.
 */
export function accountTypesOwed(held: readonly AccountType[], seats: readonly HeldSeat[]): GrantableAccountType[] {
  const owed: GrantableAccountType[] = [DEFAULT_ACCOUNT_TYPE];
  if (seats.some((seat) => !seat.demo && seat.role === "caregiver")) owed.push("caregiver");
  return owed.filter((type) => !held.includes(type));
}
