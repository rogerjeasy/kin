import type { Dictionary } from "@/i18n/dictionary";

type Copy = Dictionary["dashboard"]["speech"];

/** What Kin is doing with speech, or why it could not: one line, announced. */
export function SpeechStatus({ copy, working, error, note }: { copy: Copy; working: boolean; error: string | null; note: string | null }) {
  if (working) return <p role="status" className="text-sm text-muted-foreground">{copy.working}</p>;
  if (error !== null) return <p role="alert" className="text-sm text-danger">{copy.errors[error as keyof Copy["errors"]] ?? copy.errors.unavailable}</p>;
  if (note !== null) return <p role="status" className="text-sm wrap-anywhere text-muted-foreground">{note}</p>;
  return null;
}
