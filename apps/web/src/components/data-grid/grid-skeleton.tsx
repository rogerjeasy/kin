type GridSkeletonProps = { label: string; rows?: number };

/** What a grid shows while the rows or the person's saved view are being read. */
export function GridSkeleton({ label, rows = 5 }: GridSkeletonProps) {
  return (
    <div role="status" className="p-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-10 rounded-md bg-muted" />
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="h-12 rounded-md bg-muted/70" />
        ))}
      </div>
    </div>
  );
}
