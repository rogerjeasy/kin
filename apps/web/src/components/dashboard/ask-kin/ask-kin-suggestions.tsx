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
  "group lift inline-flex min-h-11 max-w-full items-center gap-2.5 rounded-full border bg-card px-4 py-2 text-start text-sm font-medium wrap-anywhere shadow-2xs hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-wait disabled:bg-muted";

const icon = "size-4 shrink-0 text-highlight transition-transform duration-300 ease-(--ease-out-expo) group-hover:-rotate-12 group-hover:scale-110";

/** Questions to start from, as buttons that ask them or links that carry them to Ask Kin. */
export function AskKinSuggestions({ label, questions, onPick, href, disabled = false }: Props) {
  if (questions.length === 0) return null;
  return (
    <div className="min-w-0 space-y-3">
      <p className="text-xs font-semibold tracking-widest text-muted-foreground uppercase">{label}</p>
      <ul className="enter-stagger flex min-w-0 flex-wrap gap-2">
        {questions.map((question) => (
          <li key={question} className="min-w-0 max-w-full">
            {href ? (
              <Link href={href(question)} className={chip}>
                <MessageCircleQuestionIcon aria-hidden="true" className={icon} />
                {question}
              </Link>
            ) : (
              <button type="button" className={chip} disabled={disabled} onClick={() => onPick?.(question)}>
                <MessageCircleQuestionIcon aria-hidden="true" className={icon} />
                {question}
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
