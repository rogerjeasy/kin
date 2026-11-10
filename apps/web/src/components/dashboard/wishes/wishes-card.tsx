import { FeatherIcon } from "lucide-react";

import { Panel } from "@/components/dashboard/ui/panel";

type Props = { readonly title: string; readonly text: string; readonly label: string; readonly href: string; readonly quote: string | null };

/** The overview's way into the parent's wishes, with the first of them in her words. */
export function WishesCard({ title, text, label, href, quote }: Props) {
  return (
    <Panel title={title} description={text} link={{ href, label }} aside={<FeatherIcon aria-hidden="true" className="size-6 shrink-0 text-highlight" />}>
      {quote === null ? <p className="sr-only">{title}</p> : <blockquote dir="auto" className="text-lg font-semibold text-pretty break-words">“{quote}”</blockquote>}
    </Panel>
  );
}
