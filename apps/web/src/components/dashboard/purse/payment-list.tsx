import { LockIcon } from "lucide-react";

import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";
import type { PursePaymentView } from "@/server/purse";

import { PaymentRow } from "./payment-row";

type Props = {
  payments: readonly PursePaymentView[];
  copy: Dictionary["dashboard"]["purse"];
  format: Formatters;
  parentName: string;
  isParent: boolean;
  canCancel: boolean;
  /** The id the list's region carries, so a card elsewhere can link to it. */
  id?: string;
};

/**
 * Her payments, newest first. She sees every one of hers; the family sees
 * only those she shared and those Kin held, which is all the database lets
 * them read. The read-backs she never answered are left out of her list.
 */
export function PaymentList({ payments, copy, format, parentName, isParent, canCancel, id }: Props) {
  const shown = payments.filter((payment) => (payment.state !== "proposed" && payment.state !== "expired") || payment.heldAt !== null);
  const { payments: words } = copy;
  return (
    <div id={id} className="min-w-0 scroll-mt-24">
      <Panel title={isParent ? words.title : fill(words.titleFamily, { parent: parentName })} description={isParent ? words.text : fill(words.textFamily, { parent: parentName })}>
        {shown.length === 0 ? (
          <EmptyState icon={LockIcon} text={isParent ? words.empty : fill(words.emptyFamily, { parent: parentName })} />
        ) : (
          <ul className="divide-y">
            {shown.map((payment) => (
              <PaymentRow key={payment.id} payment={payment} copy={copy} format={format} parentName={parentName} isParent={isParent} canCancel={canCancel} />
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
