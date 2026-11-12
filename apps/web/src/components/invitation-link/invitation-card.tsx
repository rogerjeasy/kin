import type { InvitationLinkState } from "@kin/db";

import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  state: InvitationLinkState;
  copy: Dictionary["joinLink"];
  /** Starts a sign-in that comes back to the circle. */
  signInHref: string;
  /** The same, on the identity provider's sign-up page. */
  signUpHref: string;
};

/**
 * What a person can do with an invitation: make an account or sign in with
 * the address it was sent to. The buttons are plain links, never prefetched,
 * because fetching one starts a sign-in. Joining happens after sign-in, when
 * the address is confirmed: nothing on this page joins anyone.
 */
export function InvitationCard({ state, copy, signInHref, signUpHref }: Props) {
  if (state === "closed") {
    return <p className="text-xl font-medium text-pretty">{copy.closed}</p>;
  }
  return (
    <div className="space-y-5">
      <p className="text-lg text-pretty">{state === "accepted" ? copy.accepted : copy.how}</p>
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {state === "open" ? (
          <Button asChild className="w-full whitespace-normal sm:w-auto">
            <a href={signUpHref}>{copy.signUp}</a>
          </Button>
        ) : null}
        <Button asChild variant={state === "open" ? "outline" : "default"} className="w-full whitespace-normal sm:w-auto">
          <a href={signInHref}>{copy.signIn}</a>
        </Button>
      </div>
    </div>
  );
}
