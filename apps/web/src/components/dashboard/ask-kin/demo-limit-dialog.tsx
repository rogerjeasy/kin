"use client";

import { LogInIcon, SparklesIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";
import { Dialog } from "radix-ui";

import { Button } from "@/components/ui/button";

export type DemoLimitLinks = {
  readonly signUp: { readonly href: string; readonly label: string };
  readonly signIn: { readonly href: string; readonly label: string };
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  text: string;
  links: DemoLimitLinks;
  /** "Keep exploring the demo": closes the window and stays. */
  stay: string;
};

/**
 * Opens the moment a demo visitor has asked their last question: sign up or
 * sign in to keep asking, or close it and go on looking around the demo.
 */
export function DemoLimitDialog({ open, onOpenChange, title, text, links, stay }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-band/60 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content className="surface fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-3xl p-6 shadow-xl data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:p-8">
          <span aria-hidden="true" className="inline-flex size-12 items-center justify-center rounded-full bg-highlight/15 text-highlight ring-1 ring-highlight/30 motion-safe:animate-glow-pulse">
            <SparklesIcon className="size-6" />
          </span>
          <Dialog.Title className="mt-5 font-serif text-subtitle text-balance">{title}</Dialog.Title>
          <Dialog.Description className="mt-3 text-pretty text-muted-foreground">{text}</Dialog.Description>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <Button asChild className="h-auto min-h-12 whitespace-normal">
              <Link href={links.signUp.href}>
                <UserPlusIcon aria-hidden="true" />
                {links.signUp.label}
              </Link>
            </Button>
            <Button asChild variant="outline" className="h-auto min-h-12 whitespace-normal">
              <Link href={links.signIn.href}>
                <LogInIcon aria-hidden="true" className="rtl:-scale-x-100" />
                {links.signIn.label}
              </Link>
            </Button>
          </div>
          <Dialog.Close asChild>
            <Button variant="ghost" className="mt-3 h-auto min-h-11 w-full whitespace-normal">
              {stay}
            </Button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
