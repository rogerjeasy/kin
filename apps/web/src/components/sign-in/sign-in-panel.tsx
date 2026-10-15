import { TriangleAlertIcon } from "lucide-react";

import { SecureNote } from "@/components/account/secure-note";
import { ButtonLink } from "@/components/shared/button-link";
import type { Dictionary } from "@/i18n/dictionary";

type SignInPanelProps = {
  copy: Dictionary["signInPage"]["form"];
  /** Starts the sign-in, carrying where to come back to. */
  href: string;
  /** Why the last attempt came back here, if it did. */
  problem: keyof Dictionary["signInPage"]["form"]["problems"] | null;
};

/**
 * The way in. The password is typed on the identity provider's own page, so
 * Kin hosts no credential form at all (docs/tech-stack.md section 9.1).
 */
export function SignInPanel({ copy, href, problem }: SignInPanelProps) {
  return (
    <div>
      {problem ? (
        <p role="alert" className="mb-5 flex gap-2.5 rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm font-medium text-danger">
          <TriangleAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0">{copy.problems[problem]}</span>
        </p>
      ) : null}
      <ButtonLink href={href} className="w-full whitespace-normal">
        {copy.submit}
      </ButtonLink>
      <SecureNote>{copy.note}</SecureNote>
    </div>
  );
}
