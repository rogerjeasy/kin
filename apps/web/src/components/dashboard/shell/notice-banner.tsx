"use client";

import { InfoIcon, XIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isNotice, type Notice } from "@/content/dashboard-notices";

type NoticeBannerProps = { notices: Readonly<Record<Notice, string>>; dismiss: string };

/** Says what an action did, once, on the screen the action returned to. */
export function NoticeBanner({ notices, dismiss }: NoticeBannerProps) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const notice = params.get("notice");
  if (!isNotice(notice)) return null;
  return (
    <div role="status" className="surface enter flex items-start gap-3 rounded-2xl px-4 py-3 text-sm">
      <InfoIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-highlight" />
      <p className="min-w-0 flex-1 text-pretty">{notices[notice]}</p>
      <Button type="button" variant="ghost" size="icon" aria-label={dismiss} className="-my-2 -me-2 size-11 shrink-0" onClick={() => router.replace(pathname, { scroll: false })}>
        <XIcon />
      </Button>
    </div>
  );
}
