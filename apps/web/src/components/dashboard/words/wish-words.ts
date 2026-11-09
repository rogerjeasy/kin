import type { WishRule, WishTrigger } from "@kin/domain";

import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

/** The names a wish can hold, by the record's own IDs. Plain data, so the browser can word a draft too. */
export type WishNameBook = {
  readonly parent: string;
  readonly payees: Readonly<Record<string, string>>;
  readonly members: Readonly<Record<string, string>>;
  readonly subscriptions: Readonly<Record<string, string>>;
};

type Copy = Dictionary["dashboard"]["wishes"];
/** Whose wish it is, for the words: hers, read by the family, or the parent's own screen. */
export type WishVoice = "she" | "you";

const nameIn = (book: Readonly<Record<string, string>>, id: string) => book[id] ?? "?";

/**
 * When a wish applies and what it does, in fixed words filled from the record:
 * never the model's wording. The read-back the parent confirms and the line the
 * family reads are the same sentence.
 */
export function wishReadBack(copy: Copy, book: WishNameBook, format: Pick<Formatters, "money" | "allOf">, wish: { readonly trigger: WishTrigger; readonly rule: WishRule }, voice: WishVoice): { readonly when: string; readonly does: string } {
  const when = fill(copy.when[voice][wish.trigger], { parent: book.parent });
  const { rule } = wish;
  const does = copy.does[voice];
  switch (rule.kind) {
    case "keep_paying":
      return { when, does: fill(does.keep_paying, { payee: nameIn(book.payees, rule.payeeId) }) };
    case "pause_discretionary":
      return { when, does: does.pause_discretionary };
    case "suspend_subscriptions":
      return { when, does: fill(does.suspend_subscriptions, { subscriptions: format.allOf(rule.subscriptionIds.map((id) => nameIn(book.subscriptions, id))) }) };
    case "new_payee_approvals":
      return { when, does: fill(does.new_payee_approvals, { amount: format.money(rule.aboveCents), approvers: format.allOf(rule.approverMemberIds.map((id) => nameIn(book.members, id))) }) };
    case "successor":
      return { when, does: fill(does.successor, { member: nameIn(book.members, rule.memberId) }) };
  }
}

/** "Rose said on Sep 12: “Always keep paying Amara…”", the line every decision made on her behalf carries. */
export function wishCitation(copy: Copy, book: WishNameBook, format: Pick<Formatters, "day">, wish: { readonly saidOn: string; readonly quote: string }): string {
  return fill(copy.citation, { parent: book.parent, day: format.day(wish.saidOn), quote: wish.quote });
}

/** The first characters of a seal, enough for a person to compare by eye. */
export const shortSeal = (digest: string): string => `${digest.slice(0, 8)}…${digest.slice(-4)}`;
