import { SpokenLines } from "@/components/shared/spoken-lines";
import { StepList } from "@/components/shared/step-list";
import type { Dictionary } from "@/i18n/dictionary";

type BillingWeekProps = {
  copy: Dictionary["caregiversPage"]["exchange"];
  people: Dictionary["common"]["people"];
};

/** What Amara says at the end of the week, beside the four things that follow. */
export function BillingWeek({ copy, people }: BillingWeekProps) {
  return (
    <div className="grid items-start gap-10 lg:grid-cols-2 lg:gap-16">
      <div className="min-w-0">
        <div className="surface rounded-3xl p-6 shadow-md sm:p-9">
          <SpokenLines
            lines={[
              { speaker: people.amara, text: copy.amaraLine, voice: "person" },
              { speaker: people.kin, text: copy.kinLine, voice: "kin", amount: copy.kinAmount },
            ]}
          />
        </div>
        <p className="mt-6 max-w-xl border-s-2 border-gold/50 ps-4 text-lg text-muted-foreground">{copy.note}</p>
      </div>
      <div className="min-w-0">
        <StepList steps={copy.steps} />
      </div>
    </div>
  );
}
