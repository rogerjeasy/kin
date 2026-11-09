import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import type { CheckView } from "@/server/presence";

import { CodeForm } from "./code-form";
import { HelpForm } from "./help-form";

type Props = {
  check: CheckView;
  locale: Locale;
  copy: Dictionary["dashboard"]["presence"];
  /** The most help may be, written out in the circle's currency: what the caller asked for. */
  max: string | null;
  approvalsHref: string;
};

/**
 * What the family can do next about a check, and nothing else: help the person if they said it was them and confirmed a
 * PayPal account (which can go only there), or put the weekly family code to the caller when the person could not be reached.
 * Neither form can name an address or read the code.
 */
export function CheckActions({ check, locale, copy, max, approvalsHref }: Props) {
  const name = check.voiceName ?? "";
  if (check.help === "available" && name !== "") return <HelpForm locale={locale} checkId={check.id} name={name} max={max} copy={copy} approvalsHref={approvalsHref} />;
  if (check.help === "raised") return <p className="text-sm text-muted-foreground">{copy.help.already}</p>;
  if (check.canCheckCode) return <CodeForm locale={locale} checkId={check.id} copy={copy} />;
  return null;
}
