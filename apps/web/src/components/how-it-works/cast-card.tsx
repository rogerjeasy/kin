import { Avatar } from "@/components/shared/avatar";
import { circlePortraits, type CircleMember } from "@/content/circle-portraits";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

const order = ["rose", "elena", "marcus", "ana", "amara"] as const satisfies readonly CircleMember[];

type CastCardProps = {
  copy: Dictionary["howItWorks"]["cast"];
  people: Dictionary["common"]["people"];
  /** The formatted amount above which Rose must say yes. */
  limit: string;
};

/** The five people the month is about, each with their part in it. */
export function CastCard({ copy, people, limit }: CastCardProps) {
  return (
    <div className="rounded-3xl border bg-card p-6 sm:p-8">
      <h2 className="text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">{copy.title}</h2>
      <ul className="mt-3 divide-y">
        {order.map((member) => (
          <li key={member} className="flex items-center gap-4 py-3.5">
            <Avatar src={circlePortraits[member]} size="lg" />
            <p className="min-w-0">
              <strong className="block font-serif text-2xl font-normal">{people[member]}</strong>
              <span className="text-muted-foreground">{fill(copy.members[member], { limit })}</span>
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
