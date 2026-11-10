import { MemberAvatar } from "@/components/dashboard/ui/member-avatar";
import { fill } from "@/i18n/template";
import type { AskView } from "@/server/quiet-shares";

import { AskCard } from "./ask-card";
import type { QuietScreen } from "./quiet-screen";

type Props = { screen: QuietScreen; name: string; portrait: string | null; asks: readonly AskView[] };

/**
 * One family member's own phone in the demo's family layout: the asks as
 * their own Kin shows them, read in their own seat. Nothing on it comes from
 * anyone else's offer or part.
 */
export function FamilyPhone({ screen, name, portrait, asks }: Props) {
  const title = fill(screen.copy.family.phone, { name });
  return (
    <section aria-label={title} className="lift min-w-0 rounded-[2.25rem] border-[6px] border-foreground/85 bg-background dark:border-input p-2 shadow-xl ring-1 ring-border sm:p-3">
      <div aria-hidden="true" className="mx-auto mt-1 mb-3 h-5 w-24 rounded-full bg-foreground/85 dark:bg-input" />
      <header className="flex min-w-0 items-center gap-3 px-2 pb-3">
        <MemberAvatar portrait={portrait} name={name} size="sm" />
        <h2 className="min-w-0 text-base font-semibold wrap-anywhere">{title}</h2>
      </header>
      <div className="grid min-w-0 gap-3">
        {asks.map((ask) => (
          <AskCard key={ask.id} screen={screen} ask={ask} />
        ))}
      </div>
    </section>
  );
}
