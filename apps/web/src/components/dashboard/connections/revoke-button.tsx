"use client";

import { BanIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { postLetterJson } from "@/components/dashboard/letters/letter-client";
import { Button } from "@/components/ui/button";

type Props = {
  /** The route that revokes: a delegation's or an agency key's. */
  url: string;
  id: string;
  label: string;
  /** The button's name for a screen reader, which says what is revoked. */
  accessibleLabel: string;
  pendingLabel: string;
  failedLabel: string;
};

/** Revokes a delegation or an agency key. The server checks who may; the next call with it is refused. */
export function RevokeButton({ url, id, label, accessibleLabel, pendingLabel, failedLabel }: Props) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function revoke() {
    setPending(true);
    setFailed(false);
    const reply = await postLetterJson(url, { operation: "revoke", id });
    setPending(false);
    if (reply.ok) router.refresh();
    else setFailed(true);
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => void revoke()} aria-label={accessibleLabel} className="min-h-11">
        <BanIcon aria-hidden="true" />
        {pending ? pendingLabel : label}
      </Button>
      {failed ? (
        <p role="alert" className="basis-full text-sm text-danger">
          {failedLabel}
        </p>
      ) : null}
    </>
  );
}
