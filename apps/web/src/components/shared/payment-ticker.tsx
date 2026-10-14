import amara from "@/assets/images/amara.jpg";
import { cn } from "@/lib/utils";

import { Avatar } from "./avatar";
import { Tag } from "./tag";

type PaymentTickerProps = { text: string; note: string; tag: string; className?: string };

/** One example payment, shown as a line from the family's feed. */
export function PaymentTicker({ text, note, tag, className }: PaymentTickerProps) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3.5 gap-y-2.5 rounded-2xl border bg-card px-4 py-3", className)}>
      <Avatar src={amara} />
      <p className="min-w-0 flex-1 basis-48 text-[0.9375rem]">
        {text}
        <span className="block text-sm text-muted-foreground">{note}</span>
      </p>
      <Tag>{tag}</Tag>
    </div>
  );
}
