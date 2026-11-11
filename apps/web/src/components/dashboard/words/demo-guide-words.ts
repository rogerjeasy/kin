import type { DemoGuideStepView, DemoGuideView } from "@/components/dashboard/shell/shell-context";
import type { GuideStep } from "@/content/demo-guide";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

type Context = {
  readonly copy: Dictionary["dashboard"]["shell"]["demo"]["guide"];
  /** The parent, the caregiver and the question to ask, by name. */
  readonly slots: { readonly parent: string; readonly caregiver: string; readonly question: string };
  readonly count: (value: number) => string;
  readonly hidden: boolean;
};

/** The guide's steps in the visitor's words. Only "Simulated" is not real: every other badge names what really runs. */
export function demoGuideWords(steps: readonly GuideStep[], { copy, slots, count, hidden }: Context): DemoGuideView {
  const worded: DemoGuideStepView[] = steps.map((step, index) => ({
    key: step.key,
    number: count(index + 1),
    title: fill(copy.steps[step.key], slots),
    badge: copy.badges[step.badge],
    real: step.badge !== "simulated",
    href: step.href,
    seat: step.seat,
  }));
  return { hidden, title: fill(copy.title, { count: count(steps.length) }), steps: worded };
}
