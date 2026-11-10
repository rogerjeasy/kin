import { FlaskConicalIcon } from "lucide-react";

/** Said at the top of every simulation screen: this is a rehearsal, not a record. */
export function SimulationBanner({ badge, text }: { badge: string; text: string }) {
  return (
    <div role="note" className="flex min-w-0 items-start gap-3 rounded-3xl border border-gold/50 bg-highlight/10 p-4 shadow-[0_0_36px_-18px_rgb(var(--glow-gold)/0.8)]">
      <FlaskConicalIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-highlight" />
      <p className="min-w-0 text-sm text-pretty">
        <strong className="font-semibold">{badge}.</strong> {text}
      </p>
    </div>
  );
}
