import { Suspense, type ReactNode } from "react";

import { CONTENT_ID } from "@/components/layout/skip-link";

import { BottomNav } from "./bottom-nav";
import { DemoBanner } from "./demo-banner";
import { DemoGuide } from "./demo-guide";
import { NoticeBanner } from "./notice-banner";
import { PresenceHoldBanner } from "./presence-hold-banner";
import type { ShellContext } from "./shell-context";
import { Sidebar } from "./sidebar";
import { TopBar } from "./top-bar";
import { WishesBanner } from "./wishes-banner";

type AppShellProps = ShellContext & { children: ReactNode };

/**
 * The frame of every signed-in screen. A wide screen has the sidebar beside
 * the page. A phone or tablet has the sections along the bottom instead, and
 * the page leaves room above them.
 */
export function AppShell({ children, ...context }: AppShellProps) {
  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[17rem_minmax(0,1fr)] print:block">
      <Sidebar {...context} />
      <div className="flex min-w-0 flex-col">
        <TopBar {...context} />
        <main id={CONTENT_ID} className="flex-1 px-4 pt-5 pb-[calc(7rem+env(safe-area-inset-bottom))] sm:px-6 lg:px-10 lg:pt-8 lg:pb-14">
          <div className="mx-auto w-full max-w-7xl space-y-6 lg:space-y-8">
            {context.demo ? (
              <div className="space-y-3 print:hidden">
                <DemoBanner locale={context.locale} copy={context.dictionary.dashboard.shell.demo} demo={context.demo} />
                <DemoGuide locale={context.locale} guide={context.demo.guide} copy={context.dictionary.dashboard.shell.demo.guide} />
              </div>
            ) : null}
            {context.presenceHold ? <PresenceHoldBanner hold={context.presenceHold} /> : null}
            {context.wishesNotice ? <WishesBanner notice={context.wishesNotice} /> : null}
            <Suspense fallback={null}>
              <NoticeBanner notices={context.notices} dismiss={context.dictionary.dashboard.notices.dismiss} />
            </Suspense>
            {children}
          </div>
        </main>
      </div>
      <BottomNav locale={context.locale} copy={context.dictionary.dashboard.shell} badges={context.badges} sections={context.sections} className="lg:hidden print:hidden" />
    </div>
  );
}
