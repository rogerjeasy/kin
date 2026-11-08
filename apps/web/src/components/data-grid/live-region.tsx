/** A polite live region for a screen reader. It is read, never seen. */
export function LiveRegion({ message }: { message: string }) {
  return (
    <p role="status" aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </p>
  );
}
