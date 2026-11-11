import { LogInIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Signs the person in again and brings them back here. A session from before
 * Kin asked for the self-service scope cannot set up an app; a fresh one can.
 */
export function SignInAgainLink({ next, label }: { next: string; label: string }) {
  return (
    <Button asChild variant="outline" className="h-auto min-h-11 w-full max-w-full whitespace-normal sm:w-auto">
      <a href={`/auth/sign-in?${new URLSearchParams({ next }).toString()}`}>
        <LogInIcon aria-hidden="true" />
        {label}
      </a>
    </Button>
  );
}
