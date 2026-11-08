import Link from "next/link";

import type { ShiftView } from "@/content/circle/shift-views";
import { priceText, type ShiftCopy } from "@/content/circle/shift-words";
import { fill } from "@/i18n/template";
import type { Formatters } from "@/lib/format";

type Props = { view: ShiftView; copy: ShiftCopy; format: Formatters; caregiver: string; parent: string; approvalsHref: string };

/** What a shift is worth and where its payment stands, in words. Nothing is shown before the shift has a price. */
export function ShiftPayment({ view, copy, format, caregiver, parent, approvalsHref }: Props) {
  const { shift, payment } = view;
  const price = priceText(copy, format, shift);
  if (price === null) return null;
  const { payment: words } = copy;
  const slots = { name: caregiver, wallet: words.wallets[view.wallet ?? "paypal"] };
  const approval = view.byPermission ? fill(words.byPermission, { parent }) : words.byFamily;
  return (
    <div className="min-w-0 space-y-1 rounded-xl bg-secondary/50 p-3 text-sm">
      <p className="font-semibold tabular-nums text-pretty">{price}</p>
      {payment === "waiting_family" ? (
        <p className="text-pretty">
          {words.waiting}{" "}
          <Link href={approvalsHref} className="inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{words.review}</Link>
        </p>
      ) : null}
      {payment === "sending" ? <p className="text-pretty">{fill(words.sending, slots)}</p> : null}
      {payment === "paid" ? <p className="text-pretty">{fill(words.paid, slots)}</p> : null}
      {payment === "declined" ? <p className="text-pretty">{words.declined}</p> : null}
      {payment === "failed" ? <p className="text-pretty">{words.failed}</p> : null}
      {payment === "sending" || payment === "paid" ? <p className="text-muted-foreground text-pretty">{approval}</p> : null}
      {shift.simulated && payment !== null ? <p className="text-xs font-medium text-muted-foreground">{words.simulatedTag}</p> : null}
    </div>
  );
}
