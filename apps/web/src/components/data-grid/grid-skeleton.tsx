type GridSkeletonProps = { label: string; rows?: number };

/** What a grid shows while the rows or the person's saved view are being read. */
export function GridSkeleton({ label, rows = 5 }: GridSkeletonProps) {
  return (
    <div role="status" className="p-4">
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-2.5">
        <div className="skeleton h-11 rounded-xl" />
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-4 rounded-xl px-3 py-3">
            <div className="skeleton h-4 w-16 shrink-0 rounded-full" />
            <div className="min-w-0 flex-1 space-y-2">
              <div className="skeleton h-3.5 w-3/5 rounded-full" />
              <div className="skeleton h-3 w-2/5 rounded-full" />
            </div>
            <div className="skeleton h-4 w-20 shrink-0 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}
