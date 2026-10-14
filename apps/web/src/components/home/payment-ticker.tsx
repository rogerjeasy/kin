import Image from "next/image";

import amara from "@/assets/images/amara.jpg";
import { Tag } from "@/components/shared/tag";

type PaymentTickerProps = { text: string; note: string; tag: string };

/** One example payment, shown as a line from the family's feed. */
export function PaymentTicker({ text, note, tag }: PaymentTickerProps) {
  return (
    <div className="mx-auto flex max-w-lg flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border bg-card px-4 py-3">
      <Image src={amara} alt="" sizes="2.75rem" className="size-11 shrink-0 rounded-full object-cover" />
      <p className="min-w-0 flex-1 basis-48 text-[0.9375rem]">
        {text}
        <span className="block text-sm text-muted-foreground">{note}</span>
      </p>
      <Tag>{tag}</Tag>
    </div>
  );
}
