import { Volume2Icon } from "lucide-react";

export type Announcement = { id: string; day: string; text: string };

/** The sentences Kin will say, word for word, in very large type and high contrast. */
export function AnnouncementList({ items }: { items: readonly Announcement[] }) {
  return (
    <ol className="space-y-6">
      {items.map((item) => (
        <li key={item.id} className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 rounded-2xl border-2 border-foreground bg-card p-5 sm:p-6">
          <span aria-hidden="true" className="mt-1 inline-flex size-10 items-center justify-center rounded-full bg-foreground text-background">
            <Volume2Icon className="size-5" />
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
