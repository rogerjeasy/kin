/** What a version changes, one sentence per term. */
export function ChangeList({ title, changes, empty }: { title: string; changes: readonly string[]; empty: string }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="enter-stagger space-y-2">
          {changes.map((change) => (
            <li key={change} className="flex min-w-0 items-start gap-2.5 rounded-2xl border border-gold/40 bg-highlight/5 px-3 py-2 wrap-anywhere">
              <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-gold shadow-[0_0_8px_2px_rgb(var(--glow-gold)/0.5)]" />
              <span className="min-w-0">{change}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
