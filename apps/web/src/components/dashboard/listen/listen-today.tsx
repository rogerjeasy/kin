import { BadgeCheckIcon, LayoutDashboardIcon, MessageCircleQuestionIcon, WalletIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionary";

export type TodayLink = { readonly key: string; readonly href: string; readonly label: string; readonly note?: string; readonly icon: "yes" | "purse" | "ask" | "overview" };

const icons: Record<TodayLink["icon"], LucideIcon> = { yes: BadgeCheckIcon, purse: WalletIcon, ask: MessageCircleQuestionIcon, overview: LayoutDashboardIcon };

type Props = { copy: Dictionary["dashboard"]["listen"]["today"]; links: readonly TodayLink[] };

/**
 * The parent's front door, above what Kin says: what waits for her yes, her
 * Purse, a question for Kin and the family's overview, each one large target
 * in large type, so the screen works by touch, keyboard and screen reader alike.
 */
export function ListenToday({ copy, links }: Props) {
  return (
    <nav aria-label={copy.heading} className="min-w-0">
      <h2 className="text-lg font-semibold text-foreground">{copy.heading}</h2>
      <ul className="mt-3 grid gap-3 sm:grid-cols-2">
        {links.map((link) => {
          const Icon = icons[link.icon];
          return (
            <li key={link.key} className="min-w-0">
              <Link
                href={link.href}
                className="flex min-h-16 min-w-0 items-center gap-4 rounded-2xl border-2 border-foreground/70 bg-card px-5 py-3 text-xl font-semibold text-foreground transition-colors hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                <Icon aria-hidden="true" className="size-7 shrink-0 text-highlight" />
                <span className="min-w-0 flex-1 wrap-anywhere">
                  {link.label}
                  {link.note ? <span className="block text-base font-normal text-muted-foreground">{link.note}</span> : null}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
