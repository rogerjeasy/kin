import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { DoorCard } from "@/components/dashboard/shift-door/door-card";
import { PageHeader } from "@/components/dashboard/ui/page-header";
import { PrintButton } from "@/components/dashboard/statement/print-button";
import { dashboardRoutes } from "@/content/dashboard-routes";
import { pageContext } from "@/i18n/page-context";
import { localizedPath } from "@/i18n/routing";
import { authConfig } from "@/server/auth/config";
import { dashboardContext, may } from "@/server/dashboard-context";
import { qrCode } from "@/server/qr-code";

export async function generateMetadata({ params }: PageProps<"/[locale]/dashboard/shifts/door">): Promise<Metadata> {
  const { dictionary } = await pageContext(params);
  return { title: `${dictionary.dashboard.shiftDoor.meta} · Kin`, robots: { index: false, follow: false } };
}

/**
 * The door tag: a card to print for the door, or to write onto an NFC tag. Its
 * code opens the caregiver's own shifts, where who they are comes from their
 * own sign-in. Whoever runs the calendar may print it; nobody else is shown it.
 */
export default async function ShiftDoorPage({ params }: PageProps<"/[locale]/dashboard/shifts/door">) {
  const { locale, dictionary, circle } = await dashboardContext(params, "shifts");
  const shiftsPath = localizedPath(locale, dashboardRoutes.shifts);
  if (!may(circle, "shift.door")) redirect(shiftsPath);
  const copy = dictionary.dashboard.shiftDoor;
  const address = `${authConfig().webOrigin}${shiftsPath}`;

  return (
    <>
      <div className="print:hidden">
        <PageHeader
          title={copy.title}
          lede={copy.lede}
          actions={
            <>
              <Link href={shiftsPath} className="inline-flex min-h-11 items-center text-sm font-semibold underline-offset-4 hover:underline">
                {copy.back}
              </Link>
              <PrintButton label={copy.print} />
            </>
          }
        />
      </div>
      <DoorCard copy={copy} code={qrCode(address)} address={address} />
    </>
  );
}
