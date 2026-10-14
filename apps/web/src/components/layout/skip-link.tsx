export const CONTENT_ID = "content";

/** Hidden until focused. Lets a keyboard user jump past the header. */
export function SkipLink({ label }: { label: string }) {
  return (
    <a
      href={`#${CONTENT_ID}`}
      className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:start-4 focus-visible:top-4 focus-visible:z-50 focus-visible:rounded-lg focus-visible:bg-card focus-visible:px-4 focus-visible:py-3 focus-visible:font-medium"
    >
      {label}
    </a>
  );
}
