import type { CircleSnapshot } from "@kin/db";

import type { Dictionary } from "@/i18n/dictionary";

import { parentNameOf } from "./members";

/** How the screens name the people, payees and categories of one circle. */
export type CircleNames = {
  /** A member's name, Kin's own for `null` (Kin raised it), or the ID if unknown. */
  readonly member: (memberId: string | null) => string;
  readonly payee: (payeeId: string) => string;
  /** Whoever or whatever a ledger account is about: a member, a payee or a category. */
  readonly subject: (subject: string) => string;
  readonly category: (category: string) => string;
  /** The parent the circle cares for, by name, or the circle's name when it has none. */
  readonly parent: string;
};

/** Names come from the circle's own rows; categories and Kin's name from the dictionary. */
export function circleNames(circle: CircleSnapshot, dictionary: Dictionary): CircleNames {
  const members = new Map(circle.members.map((member) => [member.id, member.displayName]));
  const payees = new Map(circle.payees.map((payee) => [payee.id, payee.name]));
  const categories: Record<string, string> = dictionary.dashboard.common.categories;
  const category = (key: string) => categories[key] ?? key;
  return {
    member: (memberId) => (memberId === null ? dictionary.common.people.kin : (members.get(memberId) ?? memberId)),
    payee: (payeeId) => payees.get(payeeId) ?? payeeId,
    subject: (subject) => members.get(subject) ?? payees.get(subject) ?? category(subject),
    category,
    parent: parentNameOf(circle),
  };
}
