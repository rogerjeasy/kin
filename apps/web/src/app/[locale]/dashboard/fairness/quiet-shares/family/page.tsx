import type { Metadata } from "next";
import { ArrowLeftIcon } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FamilyPhone } from "@/components/dashboard/quiet-shares/family-phone";
import { screenFor } from "@/components/dashboard/quiet-shares/screen-for";
import { EmptyPanel } from "@/components/dashboard/ui/empty-panel";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { Button } from "@/components/ui/button";
import { quietSharesRoute } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { dashboardContext } from "@/server/dashboard-context";
import { databases } from "@/server/database";
import { familySeats } from "@/server/quiet-shares";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/fairness/quiet-shares/family">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  const { title, description } = dictionary.dashboard.quietShares.family.meta;
  return { title, description, robots: { index: false, follow: false } };
}

/**
 * The demo's family layout: each person who shares the cost, on their own
 * phone, side by side. Each phone is read in that person's own seat, so it
 * shows only what their own Kin shows them. A real circle has no such page.
 */
export default async function QuietSharesFamilyPage({ params }: PageProps<"/[locale]/dashboard/fairness/quiet-shares/family">) {
  const { locale, dictionary, circle, viewer } = await dashboardContext(params, "fairness");
  const seats = await familySeats({ db: databases().app, userId: viewer.userId, circle });
  if (seats === null) notFound();
  const copy = dictionary.dashboard.quietShares;
  const showing = seats.map((seat) => ({ ...seat, asks: seat.asks.filter((ask) => ask.state !== "withdrawn").slice(0, 1) }));

  return (
    <>
      <PageHeader
        title={copy.family.title}
        lede={copy.family.lede}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={localizedPath(locale, quietSharesRoute)}>
              <ArrowLeftIcon aria-hidden="true" className="rtl:-scale-x-100" />
              {copy.family.back}
            </Link>
          </Button>
        }
      />
      {showing.every((seat) => seat.asks.length === 0) ? (
        <EmptyPanel title={copy.family.title} text={copy.family.none} />
      ) : (
        <div className="grid min-w-0 items-start gap-6 xl:grid-cols-3">
          {showing.map((seat) => (
            <FamilyPhone key={seat.memberId} screen={screenFor(locale, dictionary, circle, seat)} name={seat.name} portrait={seat.portrait} asks={seat.asks} />
          ))}
        </div>
      )}
    </>
  );
}
