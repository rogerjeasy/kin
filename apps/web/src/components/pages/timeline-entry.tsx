type TimelineEntryProps = {
  day: string;
  title: string;
  text: string;
  /** Who speaks the quote. Empty when the entry has no quote. */
  speaker: string;
  quote: string;
};

/** One day of the month: what happened, and what was said. */
export function TimelineEntry({ day, title, text, speaker, quote }: TimelineEntryProps) {
  return (
    <li className="grid gap-x-10 gap-y-2 border-t py-8 md:grid-cols-[8rem_minmax(0,1fr)]">
      <p className="pt-1 font-mono text-sm font-medium text-highlight uppercase ltr:tracking-widest">{day}</p>
      <div className="min-w-0 max-w-3xl">
        <h3 className="font-serif text-subtitle">{title}</h3>
        <p className="mt-3 text-lg text-muted-foreground">{text}</p>
        {quote ? (
          <figure className="mt-5 rounded-2xl border bg-card px-5 py-4">
            <figcaption className="text-sm font-medium text-muted-foreground">{speaker}</figcaption>
            <blockquote className="mt-1 font-serif text-speech">{quote}</blockquote>
          </figure>
        ) : null}
      </div>
    </li>
  );
}
