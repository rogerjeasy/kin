"use client";

import { ChevronDownIcon, GlobeIcon, LogOutIcon, UsersIcon } from "lucide-react";
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

type AccountMenuProps = {
  copy: Dictionary["dashboard"]["shell"]["account"];
  name: string;
  email: string;
  links: { circle: string; website: string };
};

const itemClass = "min-h-11 gap-3 px-3 text-base";

/** Who is signed in, and the ways out of the circle's screens. */
export function AccountMenu({ copy, name, email, links }: AccountMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" aria-label={`${copy.menu}: ${name}`} className="gap-2 px-1.5 sm:pe-3">
          <InitialsAvatar name={name} />
          <span className="hidden max-w-36 truncate text-foreground sm:inline">{name}</span>
          <ChevronDownIcon className="hidden size-4 sm:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="px-3 py-2 font-normal">
          <span className="block text-xs text-muted-foreground">{copy.signedInAs}</span>
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-sm text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild className={itemClass}>
          <Link href={links.circle}>
            <UsersIcon aria-hidden="true" />
            {copy.settings}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild className={itemClass}>
          <Link href={links.website}>
            <GlobeIcon aria-hidden="true" />
            {copy.website}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {/* Signing out is a POST, so no link on another site can do it. */}
        <form action="/auth/sign-out" method="post">
          <DropdownMenuItem asChild className={`${itemClass} w-full`}>
            <button type="submit">
              <LogOutIcon aria-hidden="true" />
              {copy.signOut}
            </button>
          </DropdownMenuItem>
        </form>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
