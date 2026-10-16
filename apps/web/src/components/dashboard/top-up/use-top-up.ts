"use client";

import { centsFromDecimal, checkTopUp } from "@kin/domain";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import type { PaymentSession, PaymentSessionCallbacks, PayPalSdk } from "./paypal-sdk";
import { TopUpRefused, captureTopUp, createTopUpOrder, isRecorded } from "./top-up-api";

export type TopUpPhase =
  | { readonly kind: "choose" }
  | { readonly kind: "paying" }
  | { readonly kind: "confirming" }
  | { readonly kind: "confirmed"; readonly cents: number }
  | { readonly kind: "slow" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "declined" }
  | { readonly kind: "failed" };

const POLL_MS = 1_500;
/** How long the sheet waits for the worker before saying the record will catch up. */
const POLL_LIMIT_MS = 45_000;

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The amount typed, in cents, or `null` when it is not one a top-up may be. */
export function topUpCents(text: string, currency: string): number | null {
  try {
    const cents = centsFromDecimal(text.trim(), currency);
    return checkTopUp({ cents, currency }).ok ? cents : null;
  } catch {
    return null;
  }
}

/**
 * One top-up from the button press to the ledger: the order is opened on the
 * server, the payer approves in PayPal, the server captures it, and the sheet
 * waits until the worker has recorded what PayPal confirms.
 */
export function useTopUp(options: { locale: string; currency: string }) {
  const { locale, currency } = options;
  const router = useRouter();
  const [phase, setPhase] = useState<TopUpPhase>({ kind: "choose" });
  const amountCents = useRef(0);

  const confirm = useCallback(
    async (captureId: string) => {
      setPhase({ kind: "confirming" });
      for (let waited = 0; waited < POLL_LIMIT_MS; waited += POLL_MS) {
        await wait(POLL_MS);
        if (await isRecorded(captureId).catch(() => false)) {
          setPhase({ kind: "confirmed", cents: amountCents.current });
          router.refresh();
          return;
        }
      }
      setPhase({ kind: "slow" });
    },
    [router],
  );

  /** A payment session for one of PayPal's buttons. Its callbacks touch only stable state. */
  const sessionOf = useCallback(
    (sdk: PayPalSdk, method: "paypal" | "paylater"): PaymentSession => {
      const callbacks: PaymentSessionCallbacks = {
        async onApprove({ orderId }) {
          try {
            const captureId = await captureTopUp(orderId);
            if (captureId === null) setPhase({ kind: "slow" });
            else await confirm(captureId);
          } catch (error) {
            setPhase({ kind: error instanceof TopUpRefused && error.reason === "declined" ? "declined" : "failed" });
          }
        },
        onCancel() {
          setPhase({ kind: "cancelled" });
        },
        onError() {
          setPhase({ kind: "failed" });
        },
      };
      return method === "paypal" ? sdk.createPayPalOneTimePaymentSession(callbacks) : sdk.createPayLaterOneTimePaymentSession(callbacks);
    },
    [confirm],
  );

  /**
   * Starts PayPal for `amount`. Called straight from the click, with no await
   * before `start`, or the browser would block PayPal's window.
   */
  const pay = useCallback(
    (session: PaymentSession, amount: string): boolean => {
      const cents = topUpCents(amount, currency);
      if (cents === null) return false;
      amountCents.current = cents;
      setPhase({ kind: "paying" });
      session.start({ presentationMode: "auto" }, createTopUpOrder(amount.trim(), locale)).catch(() => setPhase({ kind: "failed" }));
      return true;
    },
    [currency, locale],
  );

  const reset = useCallback(() => setPhase({ kind: "choose" }), []);

  return { phase, pay, sessionOf, reset };
}
