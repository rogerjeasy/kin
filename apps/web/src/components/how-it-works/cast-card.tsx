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
    <div className="rounded-3xl border border-foreground/10 bg-card/70 p-6 shadow-xl backdrop-blur-md sm:p-8">
      <h2 className="inline-flex items-center gap-2.5 text-sm font-medium text-muted-foreground uppercase ltr:tracking-widest">
        <span aria-hidden="true" className="h-px w-5 bg-gold" />
        {copy.title}
      </h2>
      <ul className="enter-stagger mt-3 divide-y divide-foreground/10">
        {order.map((member) => (
          <li key={member} className="flex items-center gap-4 py-3.5">
            <Avatar src={circlePortraits[member]} size="lg" className={member === "rose" ? "ring-2 ring-gold ring-offset-2 ring-offset-card" : "ring-1 ring-foreground/15"} />
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
