import type { ReactNode } from "react";

import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";

import { LinkScreen } from "./link-screen";

type Props = { locale: Locale; dictionary: Dictionary; children: ReactNode };

/** The page a caregiver lands on from a text, a printed code or a tag: the shared link screen, in the check-in words. */
export function CheckScreen({ locale, dictionary, children }: Props) {
  return (
    <LinkScreen locale={locale} dictionary={dictionary} copy={dictionary.checkLink}>
      {children}
    </LinkScreen>
  );
}
