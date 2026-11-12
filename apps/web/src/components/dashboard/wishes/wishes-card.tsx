import { FeatherIcon } from "lucide-react";

import { FeatureTile } from "@/components/dashboard/ui/feature-tile";

type Props = { readonly title: string; readonly text: string; readonly label: string; readonly href: string; readonly quote: string | null };

/** The overview's way into the parent's wishes, with the first of them in her words. */
export function WishesCard({ title, text, label, href, quote }: Props) {
  return (
    <FeatureTile title={title} text={text} link={{ href, label }} icon={FeatherIcon}>
      {quote === null ? null : <blockquote dir="auto" className="text-base font-semibold">“{quote}”</blockquote>}
    </FeatureTile>
  );
}
