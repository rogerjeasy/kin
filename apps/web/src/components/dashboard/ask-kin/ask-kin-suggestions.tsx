import { MessageCircleQuestionIcon } from "lucide-react";
import Link from "next/link";

type Props = {
  label: string;
  questions: readonly string[];
  /** Ask the question here, or link to the Ask Kin screen with it filled in. */
  onPick?: (question: string) => void;
  href?: (question: string) => string;
  disabled?: boolean;
};

const chip =
  "inline-flex min-h-11 max-w-full items-center gap-2 rounded-full border bg-background px-4 py-2 text-start text-sm font-medium wrap-anywhere hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-60";

/** Questions to start from, as buttons that ask them or links that carry them to Ask Kin. */
export function AskKinSuggestions({ label, questions, onPick, href, disabled = false }: Props) {
  if (questions.length === 0) return null;
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-sm font-semibold text-muted-foreground">{label}</p>
      <ul className="flex min-w-0 flex-wrap gap-2">
        {questions.map((question) => (
          <li key={question} className="min-w-0 max-w-full">
            {href ? (
              <Link href={href(question)} className={chip}>
                <MessageCircleQuestionIcon aria-hidden="true" className="size-4 shrink-0" />
                {question}
              </Link>
            ) : (
              <button type="button" className={chip} disabled={disabled} onClick={() => onPick?.(question)}>
                <MessageCircleQuestionIcon aria-hidden="true" className="size-4 shrink-0" />
                {question}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
