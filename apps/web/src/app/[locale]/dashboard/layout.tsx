import { PAUSE_HOURS } from "@kin/domain";

import { AppShell } from "@/components/dashboard/shell/app-shell";
import { DEMO_NOW, DEMO_PERIOD } from "@/content/demo-circle/clock";
import { circleFormatters } from "@/content/demo-circle/format";
import { waitingProposals } from "@/content/demo-circle/proposal-view";
import { dashboardContext } from "@/server/dashboard-context";
import { fill } from "@/i18n/template";

/**
 * The signed-in screens of a circle. Accounts are not built yet, so this is
 * the demo circle: Rose's October, seen by Elena, on the demo clock.
 */
export default async function DashboardLayout({ children, params }: LayoutProps<"/[locale]/dashboard">) {
  const { locale, dictionary, session } = await dashboardContext(params, "overview");
  const { shell, pause } = dictionary.dashboard;
  const format = circleFormatters(locale);
  const waiting = format.count(waitingProposals().length);
  const hours = { hours: format.count(PAUSE_HOURS) };

  return (
    <AppShell
      locale={locale}
      dictionary={dictionary}
      month={format.month(DEMO_PERIOD)}
      clock={fill(shell.clock, { date: format.longDay(DEMO_NOW) })}
      session={session}
      pause={{ ...pause, title: fill(pause.title, hours), confirm: fill(pause.confirm, hours) }}
      badges={{ approvals: { value: waiting, label: fill(shell.waiting, { count: waiting }) } }}
    >
      {children}
    </AppShell>
  );
}
