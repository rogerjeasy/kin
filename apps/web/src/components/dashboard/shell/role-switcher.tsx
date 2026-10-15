"use client";

import { CheckIcon, ChevronDownIcon, UserRoundIcon } from "lucide-react";

import { MemberAvatar } from "@/components/dashboard/ui/member-avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { Locale } from "@/i18n/locales";
import { switchDemoRole } from "@/server/demo-actions";

import type { DemoPersona } from "./shell-context";

type RoleSwitcherProps = { locale: Locale; label: string; seat: string; personas: readonly DemoPersona[] };

/**
 * Lets a demo visitor take any persona's seat and see the circle as that
 * role sees it. Each choice is a form, so the server moves the seat and
 * row-level security then decides what the new role reads.
 */
export function RoleSwitcher({ locale, label, seat, personas }: RoleSwitcherProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="min-h-11 max-w-full justify-start">
          <UserRoundIcon aria-hidden="true" />
          <span className="min-w-0 truncate">{seat}</span>
          <ChevronDownIcon aria-hidden="true" className="ms-auto" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-72 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="px-3 py-2 text-xs font-normal text-muted-foreground">{label}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {personas.map((persona) => (
          <form key={persona.memberId} action={switchDemoRole}>
            <input type="hidden" name="locale" value={locale} />
            <input type="hidden" name="member" value={persona.memberId} />
            <DropdownMenuItem asChild className="min-h-11 w-full gap-3 px-3" disabled={persona.current}>
              <button type="submit" aria-current={persona.current ? "true" : undefined}>
                <MemberAvatar portrait={persona.portrait} name={persona.name} size="sm" />
                <span className="min-w-0 flex-1 text-start">
                  <span className="block truncate font-medium">{persona.name}</span>
                  <span className="block truncate text-sm text-muted-foreground">{persona.role}</span>
                </span>
                {persona.current ? <CheckIcon aria-hidden="true" className="text-highlight" /> : null}
              </button>
            </DropdownMenuItem>
          </form>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
