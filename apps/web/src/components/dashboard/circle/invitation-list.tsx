import { MailIcon } from "lucide-react";

import { StatusPill } from "@/components/dashboard/ui/status-pill";

export type InvitationItem = { id: string; email: string; role: string; status: string; pending: boolean; detail: string };

/** Who has been invited, to which role, and whether they have joined. */
export function InvitationList({ items }: { items: readonly InvitationItem[] }) {
  return (
    <ul className="divide-y border-t">
      {items.map((item) => (
        <li key={item.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <MailIcon aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <p className="font-medium break-all">{item.email}</p>
              <p className="text-sm text-muted-foreground">
                {item.role}
                {item.detail ? ` · ${item.detail}` : ""}
              </p>
            </div>
          </div>
          <StatusPill tone={item.pending ? "waiting" : "neutral"}>{item.status}</StatusPill>
        </li>
      ))}
    </ul>
  );
}
