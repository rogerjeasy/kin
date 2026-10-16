"use client";

import type { DetailedHTMLProps, HTMLAttributes } from "react";

import type { PaymentSession, PayLater } from "./paypal-sdk";

type ElementProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement>;

// PayPal's buttons are web components its SDK defines once it has loaded.
declare module "react" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- React types JSX elements in this namespace.
  namespace JSX {
    interface IntrinsicElements {
      "paypal-button": ElementProps & { type?: "pay" };
      "paypal-pay-later-button": ElementProps & { productCode?: string; countryCode?: string };
    }
  }
}

export type PayPalSessions = { readonly paypal: PaymentSession | null; readonly payLater: PaymentSession | null };

type PayPalButtonsProps = {
  sessions: PayPalSessions;
  payLater: PayLater | null;
  /** Called from the click itself, so PayPal's window may open. */
  onPay: (session: PaymentSession) => void;
};

/** PayPal's own buttons, for the methods PayPal offers this payer. */
export function PayPalButtons({ sessions, payLater, onPay }: PayPalButtonsProps) {
  const { paypal, payLater: later } = sessions;
  return (
    <div className="grid min-w-0 gap-3">
      {paypal ? <paypal-button type="pay" className="block min-h-11 w-full" onClick={() => onPay(paypal)} /> : null}
      {later && payLater ? (
        <paypal-pay-later-button className="block min-h-11 w-full" productCode={payLater.productCode} countryCode={payLater.countryCode} onClick={() => onPay(later)} />
      ) : null}
    </div>
  );
}
