import { LogInIcon, SparklesIcon, UserPlusIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import type { DemoLimitLinks } from "./demo-limit-dialog";

type Props = { title: string; text: string; links: DemoLimitLinks };

/** Shown in place of the question box once a demo visitor has asked all their questions. */
export function DemoLimitCard({ title, text, links }: Props) {
  return (
    <section aria-labelledby="demo-limit-title" className="enter min-w-0 space-y-4 rounded-3xl border border-highlight/30 bg-highlight/8 p-5 sm:p-6">
      <span aria-hidden="true" className="inline-flex size-11 items-center justify-center rounded-full bg-highlight/15 text-highlight ring-1 ring-highlight/30">
        <SparklesIcon className="size-5" />
      </span>
      <h2 id="demo-limit-title" className="text-lg font-semibold tracking-tight text-balance">
        {title}
      </h2>
      <p className="text-pretty text-muted-foreground">{text}</p>
      <div className="flex flex-wrap gap-3">
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
    </section>
  );
}
