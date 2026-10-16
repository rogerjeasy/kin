"use client";

import { WalletIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import type { Dictionary } from "@/i18n/dictionary";
import { fill } from "@/i18n/template";

import { AmountPicker } from "./amount-picker";
import { PayPalButtons } from "./paypal-buttons";
import { usePayPalSdk } from "./paypal-sdk";
import { TopUpStatus } from "./top-up-status";
import { isChoosing, problemText, progressText } from "./top-up-words";
import { useTopUp } from "./use-top-up";

type TopUpSheetProps = {
  locale: string;
  copy: Dictionary["dashboard"]["topUp"];
  /** The circle's name, for the sheet's opening line. */
  circle: string;
  clientId: string;
  sdkUrl: string;
  currency: string;
  presets: readonly { value: string; label: string }[];
  /** The smallest and largest top-up, formatted. */
  limits: { min: string; max: string };
};

/**
 * A member adds money to the pool through PayPal. The amount is checked here
 * for quick feedback and again on the server, which alone opens the order.
 */
export function TopUpSheet({ locale, copy, circle, clientId, sdkUrl, currency, presets, limits }: TopUpSheetProps) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(presets[1]?.value ?? "");
  const [invalid, setInvalid] = useState(false);
  const sdk = usePayPalSdk({ enabled: open, src: sdkUrl, clientId, currency });
  const { phase, pay, sessionOf, reset } = useTopUp({ locale, currency });
  // One session per button for each SDK instance, however often the sheet re-renders.
  const sessions = useMemo(
    () =>
      sdk.status === "ready"
        ? { paypal: sdk.paypal ? sessionOf(sdk.sdk, "paypal") : null, payLater: sdk.payLater ? sessionOf(sdk.sdk, "paylater") : null }
        : null,
    [sdk, sessionOf],
  );
  const problem = problemText(phase, copy);
  const noButtons = sdk.status === "unavailable" || (sdk.status === "ready" && !sdk.paypal && sdk.payLater === null);

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && isChoosing(phase)) reset();
      }}
    >
      <SheetTrigger asChild>
        <Button type="button" size="sm" className="min-h-11">
          <WalletIcon aria-hidden="true" />
          {copy.trigger}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] pb-[calc(1.5rem+env(safe-area-inset-bottom))] sm:max-w-md">
        <SheetTitle className="pe-8 font-serif text-subtitle font-normal text-balance">{copy.title}</SheetTitle>
        <SheetDescription className="mt-3 text-base">{fill(copy.text, { circle })}</SheetDescription>
        <p className="mt-4 rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">{copy.sandbox}</p>

        {isChoosing(phase) ? (
          <div className="mt-6 grid gap-5">
            <AmountPicker
              label={copy.amount}
              hint={fill(copy.amountHint, limits)}
              presetsLabel={copy.presets}
              presets={presets}
              value={amount}
              error={invalid ? fill(copy.invalid, limits) : null}
              onChange={(value) => {
                setAmount(value);
                setInvalid(false);
              }}
            />
            <div aria-live="polite" className="grid gap-3">
              {problem === null ? null : <TopUpStatus tone="problem" text={problem} />}
              {sdk.status === "loading" ? <TopUpStatus tone="working" text={copy.loading} /> : null}
              {noButtons ? <TopUpStatus tone="problem" text={copy.unavailable} /> : null}
            </div>
            {sessions !== null && sdk.status === "ready" ? (
              <PayPalButtons
                sessions={sessions}
                payLater={sdk.payLater}
                onPay={(session) => {
                  if (!pay(session, amount)) setInvalid(true);
                }}
              />
            ) : null}
          </div>
        ) : (
          <div aria-live="polite" className="mt-6 grid gap-4">
            <TopUpStatus tone={phase.kind === "confirmed" ? "done" : "working"} text={progressText(phase, copy, { locale, currency })} />
            {phase.kind === "confirmed" || phase.kind === "slow" ? (
              <Button type="button" variant="outline" className="min-h-11 justify-self-start" onClick={reset}>
                {copy.again}
              </Button>
            ) : null}
          </div>
        )}

        <SheetClose asChild>
          <Button type="button" variant="ghost" className="mt-4 min-h-11 self-start">
            {copy.close}
          </Button>
        </SheetClose>
      </SheetContent>
    </Sheet>
  );
}
