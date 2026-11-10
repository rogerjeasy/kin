import type { PillTone } from "@/components/dashboard/ui/status-pill";
import type { CircleNames } from "@/content/circle/names";
import type { ClaimCheckView } from "@/content/circle/safety";
import { shownVerdict, type ShownVerdict } from "@/content/circle/verdict";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

export type CheckWords = {
  readonly title: string;
  readonly text: string;
  /** The verdict's name, as the letters and the office line say it. */
  readonly verdict: string;
  readonly tone: Extract<PillTone, "danger" | "positive" | "waiting">;
  readonly day: string;
};

const TONES = { match: "positive", no_match: "danger", already_paid: "danger", unclear: "waiting" } as const satisfies Record<ShownVerdict, CheckWords["tone"]>;

type Context = { readonly dictionary: Dictionary; readonly names: CircleNames; readonly format: Formatters; readonly parent: string };

/**
 * A demand Kin checked, told whatever its verdict. A known payee's demand
 * already paid is told as the false demand it is, beside the real payment;
 * every other check, the one that matches nothing on record above all, is
 * told by its verdict with what was said.
 */
export function checkWords({ dictionary, names, format, parent }: Context, check: ClaimCheckView, place: "overview" | "bills"): CheckWords {
  const shown = shownVerdict(check.verdict, check.payeeId);
  const day = format.day(check.checkedOn);
  const payee = check.payeeId === null ? "" : names.payee(check.payeeId);
  const alerted = format.allOf(check.alerted.map(names.member));
  const base = { verdict: dictionary.dashboard.letters.check.verdicts[shown], tone: TONES[shown], day };
  if (shown === "already_paid" && check.claimedCents !== null && check.lastPaid !== null) {
    const copy = place === "overview" ? dictionary.dashboard.overview.safety : dictionary.dashboard.bills.checks.falseDemand;
    const told = { day, parent, payee, alerted, claimed: format.money(check.claimedCents), paid: format.money(check.lastPaid.cents), paidDay: format.day(check.lastPaid.day) };
    return { ...base, title: fill(copy.title, told), text: fill(copy.text, told) };
  }
  const story = dictionary.dashboard.checkStory;
  const slots = { day, parent, payee };
  const text = [
    fill(story[shown].text, slots),
    check.alerted.length > 0 ? fill(story.alerted, { alerted }) : null,
    check.claim.trim() === "" ? null : fill(story.said, { claim: check.claim.trim() }),
  ].filter((sentence) => sentence !== null);
  return { ...base, title: fill(story[shown].title, slots), text: text.join(" ") };
}
