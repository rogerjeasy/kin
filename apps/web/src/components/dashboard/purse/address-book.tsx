import { BadgeCheckIcon, BookUserIcon, ClockIcon } from "lucide-react";

import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import { StatusPill } from "@/components/dashboard/ui/status-pill";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { PursePayeeView } from "@/server/purse";

import { PayeeActions, PayeeForm } from "./payee-actions";

type Props = { payees: readonly PursePayeeView[]; copy: Dictionary["dashboard"]["purse"]; parentName: string; isParent: boolean; canAdd: boolean; canRemove: boolean };

/** The people and places she may pay on her word alone, each verified once by the family. */
export function AddressBook({ payees, copy, parentName, isParent, canAdd, canRemove }: Props) {
  const { book } = copy;
  return (
    <Panel title={isParent ? book.titleMine : book.title} description={fill(isParent ? book.textMine : book.text, { parent: parentName })} aside={<BookUserIcon aria-hidden="true" className="size-6 shrink-0 text-muted-foreground" />}>
      <div className="min-w-0 space-y-4">
        {payees.length === 0 ? (
          <EmptyState text={book.empty} />
        ) : (
          <ul className="divide-y">
            {payees.map((payee) => (
              <li key={payee.id} className="flex min-w-0 flex-col gap-3 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-lg font-semibold wrap-anywhere">
                    {payee.name}
                    <span className="font-normal text-muted-foreground"> · {payee.relationship}</span>
                  </p>
                  <p className="text-sm wrap-anywhere text-muted-foreground" dir="ltr">
                    {payee.receiver}
                  </p>
                  {payee.verified ? (
                    <StatusPill tone="positive" icon={BadgeCheckIcon}>
                      {fill(book.verified, { name: payee.verifiedByName ?? "" })}
                    </StatusPill>
                  ) : (
                    <StatusPill tone="waiting" icon={ClockIcon}>
                      {book.waiting}
                    </StatusPill>
                  )}
                  <p className="text-xs text-muted-foreground">{fill(book.addedBy, { name: payee.addedByName })}</p>
                </div>
                <PayeeActions payeeId={payee.id} name={payee.name} canVerify={payee.canVerify} canRemove={canRemove} copy={copy} />
              </li>
            ))}
          </ul>
        )}
        {canAdd ? <PayeeForm copy={copy} parentName={parentName} /> : null}
      </div>
    </Panel>
  );
}
