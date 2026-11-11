"use client";

import type { AgWidgetParams } from "ag-studio";
import { AgIncompleteDataMappingOverlay } from "ag-studio-react";
import { ShieldCheckIcon } from "lucide-react";
import { use } from "react";

import { fill } from "@/i18n/template";

import { centsOf, type PaypalVerifiedState, type StudioContext } from "./studio-context";

/** IDs shown in full; the rest are counted. */
const SHOWN = 4;

/**
 * Kin's PayPal-verified tile: how many entries a real PayPal sandbox event
 * stands behind, each with PayPal's own ID. An entry with no PayPal ID is
 * simulated and is never counted here (AGENTS.md section 5, invariant 9).
 */
export function PaypalVerifiedWidget({ widgetApi, dataMapping, context }: AgWidgetParams<PaypalVerifiedState, unknown, StudioContext>) {
  const id = dataMapping.paypalId?.at(0);
  const amount = dataMapping.amount?.at(0);
  if (!id || !amount) return <AgIncompleteDataMappingOverlay />;

  const response = use(widgetApi.getData({ fields: [id, amount] }, { queryId: "paypal-verified" }));
  const confirmed = response.results.rows.flatMap((row) => {
    const paypalId = row[id.key];
    const cents = centsOf(row[amount.key]);
    return typeof paypalId === "string" && paypalId !== "" && cents !== null ? [{ paypalId, cents }] : [];
  });
  const { copy, format } = context;
  const words = copy.widgets.verified;

  return (
    <div className="flex h-full min-w-0 flex-col gap-3 overflow-auto px-4 py-3">
      <p className="flex items-center gap-3">
        <span aria-hidden="true" className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-positive">
          <ShieldCheckIcon className="size-5" />
        </span>
        <span className="min-w-0">
          <span className="block font-serif text-3xl leading-none tabular-nums">{format.count(confirmed.length)}</span>
          <span className="block text-sm text-muted-foreground">{words.count}</span>
        </span>
      </p>
      {confirmed.length === 0 ? (
        <p className="text-sm text-muted-foreground">{words.none}</p>
      ) : (
        <ul className="flex min-w-0 flex-col gap-1.5 text-sm">
          {confirmed.slice(0, SHOWN).map((entry) => (
            <li key={entry.paypalId} className="flex min-w-0 items-baseline justify-between gap-3">
              <code className="min-w-0 truncate font-mono text-xs">{entry.paypalId}</code>
              <span className="shrink-0 tabular-nums">{format.money(entry.cents)}</span>
            </li>
          ))}
          {confirmed.length > SHOWN ? <li className="text-muted-foreground">{fill(words.more, { count: format.count(confirmed.length - SHOWN) })}</li> : null}
        </ul>
      )}
    </div>
  );
}
