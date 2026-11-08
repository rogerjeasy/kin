import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Slots = Dictionary["dashboard"]["approvals"]["slots"];

type Vote = {
  readonly name: string;
  readonly decision: "approve" | "reject";
  readonly method: keyof Slots["methods"];
  readonly time: string;
};

/**
 * One recorded answer in words. A standing permission is a rule the parent set
 * earlier, so the line never says she "said yes" when the rule decided.
 */
export function voteLine(slots: Slots, vote: Vote): string {
  const { name, method, time } = vote;
  if (method === "mandate") return fill(slots.byMandate, { name, time });
  return fill(vote.decision === "approve" ? slots.saidYes : slots.saidNo, { name, method: slots.methods[method], time });
}
