import type { CircleMember } from "@/content/circle-portraits";
import { demoMembers } from "@/content/demo-circle/members";
import { PAYEE_IDS, type PayeeId } from "@/content/demo-circle/payees";
import type { Dictionary } from "@/i18n/dictionary";

/** A member's name, or Kin's own. */
export function nameOf(dictionary: Dictionary, who: CircleMember | "kin"): string {
  return dictionary.common.people[who];
}

export function payeeName(dictionary: Dictionary, payeeId: PayeeId): string {
  return dictionary.dashboard.common.payees[payeeId];
}

/** A spending category's name. An unknown one is shown as the record holds it. */
export function categoryName(dictionary: Dictionary, category: string): string {
  const names: Record<string, string> = dictionary.dashboard.common.categories;
  return names[category] ?? category;
}

export function isMember(id: string): id is CircleMember {
  return demoMembers.some((member) => member.id === id);
}

export function isPayee(id: string): id is PayeeId {
  return (PAYEE_IDS as readonly string[]).includes(id);
}
