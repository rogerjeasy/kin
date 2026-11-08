import { decimalAmount } from "@kin/domain";
import type { CircleSnapshot } from "@kin/db";

import { Panel } from "@/components/dashboard/ui/panel";
import type { Dictionary } from "@/i18n/dictionary";
import { RateForm } from "./rate-form";

/** `demoNote` says how a demo circle pays caregivers, in place of waiting for their address. */
export function CaregiverRates({ circle, copy, demoNote = null }: { circle: CircleSnapshot; copy: Dictionary["dashboard"]["caregiverBilling"]; demoNote?: string | null }) {
  const caregivers = circle.members.filter((member) => member.role === "caregiver" && member.status === "active");
  if (caregivers.length === 0) return null;
  return (
    <Panel title={copy.setupTitle} description={copy.setupText}>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {caregivers.map((member) => {
          const payees = circle.payees.filter((payee) => payee.payee.member?.memberId === member.id);
          const configured = payees.find((payee) => payee.caregiverRateCentsPerHour !== null);
          return <RateForm key={member.id} memberId={member.id} name={configured?.name ?? payees[0]?.name ?? member.displayName} configuredPayeeId={configured?.id ?? null} receiver={configured?.receiver ?? null} demoNote={demoNote} payees={payees} rate={configured?.caregiverRateCentsPerHour == null ? "" : decimalAmount({ cents: configured.caregiverRateCentsPerHour, currency: circle.circle.currency })} copy={copy} />;
        })}
      </div>
    </Panel>
  );
}
