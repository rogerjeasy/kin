import { ShieldCheckIcon } from "lucide-react";

/** One reassuring line about where the person is about to type their details. */
export function SecureNote({ children }: { children: string }) {
  return (
    <p className="mt-5 flex gap-2.5 text-sm text-muted-foreground">
      <ShieldCheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-positive" />
      <span className="min-w-0">{children}</span>
    </p>
  );
}
