type PayeeCellProps = { name: string; detail?: string; tags?: readonly string[] };

/** Who a row is about, with a line under it and any labels. */
export function PayeeCell({ name, detail, tags = [] }: PayeeCellProps) {
  return (
    <div className="min-w-0">
      <p className="font-medium">{name}</p>
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
      {tags.length > 0 ? (
        <p className="mt-1.5 flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-full bg-secondary px-2 py-0.5 text-xs font-medium text-muted-foreground">
              {tag}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
