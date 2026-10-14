type NoteCardProps = { title: string; text: string };

/** A short statement that deserves its own box. */
export function NoteCard({ title, text }: NoteCardProps) {
  return (
    <div className="min-w-0 rounded-3xl border bg-card p-6 sm:p-9">
      <h2 className="font-serif text-subtitle">{title}</h2>
      <p className="mt-3 max-w-xl text-lg text-muted-foreground">{text}</p>
    </div>
  );
}
