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
    <section aria-label={title} className="min-w-0 rounded-[2rem] border-4 border-foreground/80 bg-background p-2 shadow-sm sm:p-3">
      <div aria-hidden="true" className="mx-auto mb-2 h-1.5 w-16 rounded-full bg-foreground/20" />
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
