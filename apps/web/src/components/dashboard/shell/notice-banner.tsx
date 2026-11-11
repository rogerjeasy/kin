"use client";

import { InfoIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isNotice, type Notice } from "@/content/dashboard-notices";

type NoticeBannerProps = {
  notices: Readonly<Record<Notice, string>>;
  dismiss: string;
  /** Where a notice leads next, when it needs the person to do something first. */
  links?: Partial<Readonly<Record<Notice, { readonly href: string; readonly label: string }>>>;
};

/** Says what an action did, once, on the screen the action returned to. */
export function NoticeBanner({ notices, dismiss, links = {} }: NoticeBannerProps) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const notice = params.get("notice");
  if (!isNotice(notice)) return null;
  const next = links[notice];
  return (
    <div role="status" className="surface enter flex items-start gap-3 rounded-2xl px-4 py-3 text-sm">
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-pretty">{notices[notice]}</p>
        {next ? (
          <Link href={next.href} className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4">
            {next.label}
          </Link>
        ) : null}
      </div>
      <Button type="button" variant="ghost" size="icon" aria-label={dismiss} className="-my-2 -me-2 size-11 shrink-0" onClick={() => router.replace(pathname, { scroll: false })}>
        <XIcon />
      </Button>
    </div>
  );
}
