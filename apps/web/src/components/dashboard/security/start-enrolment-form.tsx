import { KeyRoundIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { Locale } from "@/i18n/locales";

/**
 * Starts setting up an authenticator app. It is a POST, so no link on another
 * site can start it, and it begins with a fresh sign-in: a session alone may
 * not change an account's second factor.
 */
export function StartEnrolmentForm({ locale, label }: { locale: Locale; label: string }) {
  return (
    <form action="/auth/enrol-authenticator" method="post">
      <input type="hidden" name="locale" value={locale} />
      <Button type="submit" className="h-auto min-h-12 w-full max-w-full whitespace-normal sm:w-auto">
        <KeyRoundIcon aria-hidden="true" />
        {label}
      </Button>
    </form>
  );
}
