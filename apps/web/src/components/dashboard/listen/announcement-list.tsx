import { Volume2Icon } from "lucide-react";

export type Announcement = { id: string; day: string; text: string };

/** The sentences Kin will say, word for word, in very large type and high contrast. */
export function AnnouncementList({ items }: { items: readonly Announcement[] }) {
  return (
    <ol className="enter-stagger space-y-5">
      {items.map((item) => (
        <li key={item.id} className="relative grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-4 overflow-clip rounded-3xl border-2 border-foreground/80 bg-card p-5 shadow-sm sm:gap-x-6 sm:p-7">
          <span aria-hidden="true" className="absolute inset-y-0 start-0 w-1.5 bg-gold" />
          <span aria-hidden="true" className="mt-1 inline-flex size-12 items-center justify-center rounded-full bg-band text-band-highlight shadow-[0_0_24px_-6px_rgb(var(--glow-gold)/0.8)] ring-1 ring-band-border sm:size-14">
            <Volume2Icon className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="text-base font-semibold text-foreground">{item.day}</p>
            <p className="mt-2 font-serif text-3xl leading-snug text-pretty wrap-anywhere text-foreground sm:text-4xl">{item.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
