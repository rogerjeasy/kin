import type { Metadata } from "next";
import Link from "next/link";

import { ChangesPanel } from "@/components/dashboard/wishes/changes-panel";
import { RecordWish } from "@/components/dashboard/wishes/record-wish";
import { SubscriptionsPanel } from "@/components/dashboard/wishes/subscriptions-panel";
import { TriggerPanel } from "@/components/dashboard/wishes/trigger-panel";
import { WishCard } from "@/components/dashboard/wishes/wish-card";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Button } from "@/components/ui/button";
import { circleFormatters } from "@/content/circle/format";
import { keptPay, lastEnded, openTrigger, stillNeeded, wishNameBook, wishViews } from "@/content/circle/wishes";
import { packetRoute, wishesRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { fill } from "@/i18n/template";
import { dashboardContext, may } from "@/server/dashboard-context";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/circle/wishes">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.meta.wishes;
  return { title, description, robots: { index: false, follow: false } };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The parent's wishes. She sees "My wishes", large and voice first; the family
 * sees her words, what each does and who witnessed it; everyone sees whether a
 * trigger is reported or active and, while one is, what changed and why. A
 * caregiver, who may be paid under her wishes, sees the trigger only.
 */
export default async function WishesPage({ params, searchParams }: PageProps<"/[locale]/dashboard/circle/wishes">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "circle");
  const copy = dictionary.dashboard.wishes;
  const format = circleFormatters(locale, circle);
  const book = wishNameBook(circle);
  const parent = book.parent;
  const own = circle.viewer.role === "parent";
  const readsWishes = may(circle, "wish.view");
  const open = openTrigger(circle);
  const effects = circle.wishes.effects;
  const views = wishViews(circle);
  const me = circle.viewer.memberId;
  const frozen = open !== null;
  const change = (await searchParams).change;
  const changingView = own && !frozen && typeof change === "string" && UUID.test(change) ? (views.find((view) => view.current.wishKey === change && view.current.state === "in_force") ?? null) : null;
  const here = localizedPath(locale, wishesRoute);
  // The parent's own screen is voice first: her way to say a wish comes before anything else.
  const recorder = (
    <RecordWish
      copy={copy}
      locale={locale}
      book={book}
      currency={circle.circle.currency}
      timezone={circle.circle.timezone}
      changing={changingView === null ? null : { wishKey: changingView.current.wishKey, quote: changingView.current.quote, cancelHref: here }}
    />
  );

  return (
    <>
      <PageHeader
        title={own ? copy.titleOwn : fill(copy.title, { parent })}
        lede={fill(own ? copy.ledeOwn : copy.lede, { parent })}
        actions={
          may(circle, "money.view") && !own ? (
            <Button asChild variant="outline" className="h-auto min-h-11 w-full py-2 text-wrap sm:w-auto">
              <Link href={localizedPath(locale, packetRoute)}>{copy.packetLink}</Link>
            </Button>
          ) : null
        }
      />
      <p className={own ? "rounded-xl border bg-secondary/40 p-4 text-lg text-pretty" : "rounded-xl border bg-secondary/40 p-3 text-sm text-pretty"}>{copy.legal}</p>
      {own && !frozen ? recorder : null}
      <TriggerPanel
        copy={copy}
        book={book}
        format={format}
        open={open}
        ended={lastEnded(circle)}
        viewer={{ memberId: me, role: circle.viewer.role, mayAttest: may(circle, "wish_trigger.attest") }}
        needs={{ start: open === null ? "anyone" : stillNeeded(open, "start") }}
      />
      {effects !== null ? (
        <ChangesPanel
          copy={copy}
          book={book}
          format={format}
          locale={locale}
          effects={effects}
          kept={keptPay(circle)}
          subscriptions={circle.wishes.subscriptions}
          mayPlay={readsWishes}
          recorded={circle.wishes.wishes.flatMap((wish) => (wish.recordingId === null ? [] : [wish.id]))}
        />
      ) : null}
      {readsWishes ? (
        <section aria-labelledby="wish-list-title" className="flex min-w-0 flex-col gap-4">
          <h2 id="wish-list-title" className={own ? "text-2xl font-semibold" : "text-xl font-semibold"}>
            {own ? copy.list.titleOwn : copy.list.title}
          </h2>
          {frozen ? <p className="rounded-xl border border-highlight/40 bg-highlight/10 p-3 text-pretty">{fill(copy.frozen, { parent })}</p> : null}
          {views.length === 0 ? <EmptyPanel title={own ? copy.list.titleOwn : copy.list.title} text={fill(own ? copy.list.emptyOwn : copy.list.empty, { parent })} /> : null}
          <div className="grid min-w-0 gap-5 xl:grid-cols-2">
            {views.map(({ current, history }) => {
              const signed = current.signatures.some((signature) => signature.memberId === me);
              const successorNamed = current.rule.kind === "successor" && current.rule.memberId === me;
              return (
                <WishCard
                  key={current.id}
                  copy={copy}
                  wish={current}
                  history={history}
                  book={book}
                  format={format}
                  locale={locale}
                  voice={own ? "you" : "she"}
                  can={{
                    witness: !frozen && current.state === "confirmed" && may(circle, "wish.witness") && !signed && !successorNamed,
                    withdraw: own && !frozen && ["draft", "confirmed", "in_force"].includes(current.state),
                    change: own && !frozen && current.state === "in_force" ? `${here}?${new URLSearchParams({ change: current.wishKey })}#say` : null,
                  }}
                />
              );
            })}
          </div>
        </section>
      ) : null}
      {readsWishes ? <SubscriptionsPanel copy={copy} parent={parent} subscriptions={circle.wishes.subscriptions} format={format} canAdd={may(circle, "parent_subscription.manage")} demo={circle.circle.demo} /> : null}
    </>
  );
}
