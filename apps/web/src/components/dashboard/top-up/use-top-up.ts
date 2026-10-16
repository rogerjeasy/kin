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
  // The amount of each order this sheet opened, and the one it is following.
  // A reply about any other order is never shown, so an older top-up still
  // being confirmed cannot speak for a newer one.
  const amounts = useRef(new Map<string, number>());
  const following = useRef<string | null>(null);

  const confirm = useCallback(
    async (orderId: string, captureId: string) => {
      setPhase({ kind: "confirming" });
      for (let waited = 0; waited < POLL_LIMIT_MS; waited += POLL_MS) {
        await wait(POLL_MS);
        if (following.current !== orderId) return;
        if (await isRecorded(captureId).catch(() => false)) {
          if (following.current !== orderId) return;
          setPhase({ kind: "confirmed", cents: amounts.current.get(orderId) ?? 0 });
          router.refresh();
          return;
        }
      }
      if (following.current === orderId) setPhase({ kind: "slow" });
    },
    [router],
  );

  /** A payment session for one of PayPal's buttons. Its callbacks touch only stable state. */
  const sessionOf = useCallback(
    (sdk: PayPalSdk, method: "paypal" | "paylater"): PaymentSession => {
      const show = (orderId: string | undefined, next: TopUpPhase) => {
        if (orderId === undefined || following.current === orderId) setPhase(next);
      };
      const callbacks: PaymentSessionCallbacks = {
        // The payer said yes, so the order is captured even if the sheet has moved on.
        async onApprove({ orderId }) {
          try {
            const captureId = await captureTopUp(orderId);
            if (captureId === null) show(orderId, { kind: "slow" });
            else if (following.current === orderId) await confirm(orderId, captureId);
          } catch (error) {
            show(orderId, { kind: error instanceof TopUpRefused && error.reason === "declined" ? "declined" : "failed" });
          }
        },
        onCancel({ orderId }) {
          show(orderId, { kind: "cancelled" });
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
      following.current = null;
      setPhase({ kind: "paying" });
      const order = createTopUpOrder(amount.trim(), locale).then((created) => {
        amounts.current.set(created.orderId, cents);
        following.current = created.orderId;
        return created;
      });
      session.start({ presentationMode: "auto" }, order).catch(() => setPhase({ kind: "failed" }));
      return true;
    },
    [currency, locale],
  );

  const reset = useCallback(() => {
    following.current = null;
    setPhase({ kind: "choose" });
  }, []);

  return { phase, pay, sessionOf, reset };
}
