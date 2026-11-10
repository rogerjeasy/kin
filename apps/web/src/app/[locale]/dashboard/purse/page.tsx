import type { Metadata } from "next";
import { decimalAmount } from "@kin/domain";

import { AddressBook } from "@/components/dashboard/purse/address-book";
import { FamilySees } from "@/components/dashboard/purse/family-sees";
import { HeldAlerts } from "@/components/dashboard/purse/held-alerts";
import { PaymentList } from "@/components/dashboard/purse/payment-list";
import { PurseAsk } from "@/components/dashboard/purse/purse-ask";
import { PurseBalance } from "@/components/dashboard/purse/purse-balance";
import { PurseSetup } from "@/components/dashboard/purse/purse-setup";
import { PurseSummary } from "@/components/dashboard/purse/purse-summary";
import { LiveRefresh } from "@/components/dashboard/shifts/live-refresh";
import { EmptyState } from "@/components/dashboard/ui/empty-state";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Panel } from "@/components/dashboard/ui/panel";
import { circleFormatters } from "@/content/circle/format";
import { pageContext } from "@/i18n/page-context";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { purseScreen } from "@/server/purse";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/purse">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.purse.meta;
  return { title, description, robots: { index: false, follow: false } };
}

/** Payments that can still move by themselves, so the screen looks again until they have. */
const MOVING = new Set(["approved", "executing", "unknown"]);

/**
 * The parent's Purse. She sees her own Purse in big type, voice first: what is
 * in it, who to pay, the read-back and her answer, every payment of hers, and
 * exactly what her family sees. The family sees its ceiling, balance and the
 * month's total, any payment Kin is holding, her address book and its setup.
 */
export default async function PursePage({ params }: PageProps<"/[locale]/dashboard/purse">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "overview");
  const copy = dictionary.dashboard.purse;
  const format = circleFormatters(locale, circle);
  const screen = await purseScreen({ db: databases().app, userId: viewer.userId, circle });
  if (screen === null) return <EmptyState text={copy.notSetUp.readOnly} />;
  const values = { parent: screen.parentName };
  const { currency } = circle.circle;
  const setup = (
    <PurseSetup
      copy={copy}
      parentName={screen.parentName}
      current={screen.purse === null ? null : { weekly: decimalAmount({ cents: screen.purse.weeklyCents, currency }), ceiling: decimalAmount({ cents: screen.purse.ceilingCents, currency }), cap: decimalAmount({ cents: screen.purse.perPaymentCents, currency }) }}
      status={screen.purse?.status ?? null}
      canSetUp={may(circle, "purse.setup")}
      canStop={may(circle, "purse.stop")}
    />
  );

  if (screen.purse === null) {
    return (
      <>
        <PageHeader title={screen.isParent ? copy.mineTitle : fill(copy.title, values)} lede={fill(copy.notSetUp.text, values)} />
        <EmptyState title={copy.notSetUp.title} text={may(circle, "purse.setup") ? fill(copy.notSetUp.text, values) : copy.notSetUp.readOnly} />
        {may(circle, "purse.setup") ? setup : null}
      </>
    );
  }
  const purse = { ...screen, purse: screen.purse };
  const stopped = screen.purse.status !== "active" ? copy.paused : !screen.spendingAllowed ? copy.held : null;
  const book = <AddressBook payees={screen.payees} copy={copy} parentName={screen.parentName} isParent={screen.isParent} canAdd={may(circle, "purse_payee.add")} canRemove={may(circle, "purse_payee.add") && may(circle, "purse_payee.verify")} />;

  return (
    <>
      <PageHeader title={screen.isParent ? copy.mineTitle : fill(copy.title, values)} lede={fill(screen.isParent ? copy.mineLede : copy.lede, values)} />
      <LiveRefresh active={screen.payments.some((payment) => MOVING.has(payment.state))} />
      {stopped === null ? null : (
        <p role="status" className="rounded-xl border border-highlight/40 bg-highlight/5 p-4 text-lg font-medium">
          {stopped}
        </p>
      )}
      {screen.isParent ? (
        <>
          <div className="grid gap-6 xl:grid-cols-5">
            <div className="min-w-0 xl:col-span-2">
              <PurseBalance screen={purse} copy={copy} money={format.money} />
            </div>
            <div className="min-w-0 xl:col-span-3">
              <PurseAsk locale={locale} copy={copy} speech={dictionary.dashboard.speech} currency={currency} timezone={circle.circle.timezone} capCents={screen.purse.perPaymentCents} canAsk={stopped === null && may(circle, "purse.spend")} />
            </div>
          </div>
          <div className="grid gap-6 xl:grid-cols-2">
            <PaymentList payments={screen.payments} copy={copy} format={format} parentName={screen.parentName} isParent canCancel={may(circle, "purse.cancel")} />
            <FamilySees screen={purse} copy={copy.familySees} format={format} />
          </div>
          {book}
        </>
      ) : (
        <>
          <HeldAlerts payments={screen.payments} copy={copy} format={format} parentName={screen.parentName} capCents={screen.purse.perPaymentCents} canCancel={may(circle, "purse.cancel")} />
          <PurseSummary screen={purse} copy={copy.summary} format={format} />
          <div className="grid gap-6 xl:grid-cols-2">
            <PaymentList payments={screen.payments.filter((payment) => payment.state !== "held")} copy={copy} format={format} parentName={screen.parentName} isParent={false} canCancel={may(circle, "purse.cancel")} />
            {book}
          </div>
          {may(circle, "purse.setup") || may(circle, "purse.stop") ? setup : null}
        </>
      )}
      <Panel title={copy.never.title}>
        <ul className="list-disc space-y-2 ps-5 text-base">
          {copy.never.items.map((line) => (
            <li key={line}>{fill(line, values)}</li>
          ))}
        </ul>
      </Panel>
    </>
  );
}
