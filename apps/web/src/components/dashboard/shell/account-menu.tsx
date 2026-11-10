"use client";

import { ChevronDownIcon, GlobeIcon, LogOutIcon, ScrollTextIcon, UsersIcon } from "lucide-react";
import Link from "next/link";

import { InitialsAvatar } from "@/components/shared/initials-avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Dictionary } from "@/i18n/dictionary";
import type { Locale } from "@/i18n/locales";
import { leaveDemo } from "@/server/demo-actions";

import type { ShellContext } from "./shell-context";

type AccountMenuProps = {
  locale: Locale;
  copy: Dictionary["dashboard"]["shell"]["account"];
  leaveLabel: string;
  viewer: ShellContext["viewer"];
  /** The record is on a phone's menu rather than its bottom bar; `null` when the viewer may not open it. */
  record: { href: string; label: string } | null;
  links: { circle: string; website: string };
};

const itemClass = "min-h-11 gap-3 px-3 text-base";

/** Who is looking, and the ways out: signing out, or leaving the demo. */
export function AccountMenu({ locale, copy, leaveLabel, viewer, record, links }: AccountMenuProps) {
  const { name, email } = viewer;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="gap-2 px-1.5 sm:pe-3">
          <InitialsAvatar name={name} />
          {/* The name comes from the button's own words, so it holds the name shown on it (WCAG 2.5.3); on a phone, where the name is not shown, it is read all the same. */}
          <span className="sr-only">{`${copy.menu}: `}</span>
          <span className="hidden max-w-36 truncate text-foreground sm:inline">{name}</span>
          <span className="sr-only sm:hidden">{name}</span>
          <ChevronDownIcon className="hidden size-4 sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="px-3 py-2 font-normal">
          {viewer.kind === "person" ? <span className="block text-xs text-muted-foreground">{copy.signedInAs}</span> : null}
          <span className="block truncate font-semibold">{name}</span>
          {email ? <span className="block truncate text-sm text-muted-foreground">{email}</span> : null}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={itemClass}>
          <Link href={links.circle}>
            <UsersIcon aria-hidden="true" />
            {copy.settings}
          </Link>
        </DropdownMenuItem>
        {record ? (
          <DropdownMenuItem asChild className={`${itemClass} lg:hidden`}>
            <Link href={record.href}>
              <ScrollTextIcon aria-hidden="true" />
              {record.label}
            </Link>
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem asChild className={itemClass}>
          <Link href={links.website}>
            <GlobeIcon aria-hidden="true" />
            {copy.website}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {viewer.kind === "person" ? (
          // Signing out is a POST, so no link on another site can do it.
          <form action="/auth/sign-out" method="post">
            <DropdownMenuItem asChild className={`${itemClass} w-full`}>
              <button type="submit">
                <LogOutIcon aria-hidden="true" />
                {copy.signOut}
              </button>
            </DropdownMenuItem>
          </form>
        ) : (
          <form action={leaveDemo}>
            <input type="hidden" name="locale" value={locale} />
            <DropdownMenuItem asChild className={`${itemClass} w-full`}>
              <button type="submit">
                <LogOutIcon aria-hidden="true" />
                {leaveLabel}
              </button>
            </DropdownMenuItem>
          </form>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
