/** What a version changes, one sentence per term. */
export function ChangeList({ title, changes, empty }: { title: string; changes: readonly string[]; empty: string }) {
  return (
    <section className="min-w-0">
      <h3 className="mb-2 font-semibold">{title}</h3>
      {changes.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="list-disc space-y-1 ps-5">
          {changes.map((change) => (
            <li key={change} className="wrap-anywhere">{change}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
