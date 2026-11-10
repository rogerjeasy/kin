import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { PurseFailure } from "@/server/purse-actions";

type Props = { copy: Dictionary["dashboard"]["purse"]["errors"]; error: { readonly reason: PurseFailure; readonly availableCents?: number } | null; money: (cents: number) => string };

/** Why the Purse said no, in words, announced. Nothing was sent. */
export function PurseError({ copy, error, money }: Props) {
  if (error === null) return null;
  const errors: Readonly<Record<string, string>> = copy;
  const text = error.reason === "over_balance" ? fill(copy.over_balance, { available: money(error.availableCents ?? 0) }) : (errors[error.reason] ?? copy.unavailable);
  return (
    <p role="alert" className="text-base text-danger">
      {text}
    </p>
  );
}
