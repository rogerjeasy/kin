import { FlaskConicalIcon } from "lucide-react";

/** Said at the top of every simulation screen: this is a rehearsal, not a record. */
export function SimulationBanner({ badge, text }: { badge: string; text: string }) {
  return (
    <div role="note" className="flex min-w-0 items-start gap-3 rounded-2xl border border-highlight/40 bg-highlight/10 p-4">
      <FlaskConicalIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
      <p className="min-w-0 text-sm text-pretty">
        <strong className="font-semibold">{badge}.</strong> {text}
      </p>
    </div>
  );
}
