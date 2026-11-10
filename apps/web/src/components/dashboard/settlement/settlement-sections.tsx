import type { CircleSnapshot } from "@kin/db";
import { calendarDay, type Settlement } from "@kin/domain";

import { hasLiveSettlement, receiptRows, settlementPayments } from "@/content/circle/settlement-run";
import type { Formatters } from "@/lib/format";
import type { CircleNames } from "@/content/circle/names";
import type { Dictionary } from "@/i18n/dictionary";
import { may } from "@/server/dashboard-context";

import { ReceiptActions } from "./receipt-actions";
import { ReceiptForm } from "./receipt-form";
import { ReceiptsPanel } from "./receipts-panel";
import { SettlementReceiverForm } from "./settlement-receiver-form";
import { SettlementRunPanel } from "./settlement-run-panel";
import { SettlementSendButton } from "./settlement-send-button";

type Props = {
  circle: CircleSnapshot;
  dictionary: Dictionary;
  names: CircleNames;
  format: Formatters;
  settlement: Settlement;
  period: string;
};

/** Receipts, and paying out the month: the two ways money moves between members and the pool. */
export function SettlementSections({ circle, dictionary, names, format, settlement, period }: Props) {
  const { fairness } = dictionary.dashboard;
  const { receipts: receiptsCopy, settlementRun: run, errors, settlement: settle } = fairness;
  const categories: Record<string, string> = dictionary.dashboard.common.categories;
  const today = calendarDay(circle.circle.now, circle.circle.timezone).occurredOn;
  const rows = receiptRows(circle, names, format, receiptsCopy);
  // A demo pays its members with simulated money, so it never says PayPal is paying them.
  const { demo } = circle.circle;
  const payments = settlementPayments(circle, names, format, demo ? { ...run.states, ...run.simulatedStates } : run.states, settle.payout);
  const canPropose = may(circle, "settlement.propose") && !hasLiveSettlement(circle, period) && settlement.plan.payouts.some((payout) => payout.releasableCents > 0);
  // Demo money is simulated and goes nowhere, so a demo member has no address to give.
  const mayGiveAddress = may(circle, "settlement_receiver.set") && !demo;
  const ownAddress = circle.settlementReceivers.find((each) => each.memberId === circle.viewer.memberId)?.receiver ?? null;

  return (
    <>
      <ReceiptsPanel
        title={receiptsCopy.title}
        description={receiptsCopy.text}
        empty={receiptsCopy.empty}
        items={rows.map((row) => ({
          id: row.id,
          title: row.title,
          detail: row.detail,
          amount: row.amount,
          stateText: row.stateText,
          tone: row.tone,
          actions: row.decidable && may(circle, "receipt.decide") ? (
            <ReceiptActions receiptId={row.id} approve={receiptsCopy.approve} decline={receiptsCopy.decline} working={receiptsCopy.working} errors={errors} />
          ) : row.ownWaiting ? (
            <p className="text-sm text-muted-foreground">{receiptsCopy.own}</p>
          ) : null,
        }))}
        form={may(circle, "receipt.submit") ? <ReceiptForm copy={receiptsCopy} errors={errors} categories={categories} today={today} /> : null}
      />
      {canPropose || payments.length > 0 || mayGiveAddress ? (
        <SettlementRunPanel
          title={run.title}
          description={demo ? run.demoText : run.text}
          progressTitle={run.progressTitle}
          payments={payments}
          action={canPropose ? <SettlementSendButton copy={run} errors={errors} /> : null}
          receiver={mayGiveAddress ? <SettlementReceiverForm receiver={ownAddress} copy={run} errors={errors} /> : null}
        />
      ) : null}
    </>
  );
}
