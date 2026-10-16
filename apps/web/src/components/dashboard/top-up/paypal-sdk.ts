"use client";

import { useEffect, useState } from "react";

/**
 * The few parts of PayPal's JavaScript SDK v6 Kin uses, typed from PayPal's
 * own sample integration (paypal-examples/v6-web-sdk-sample-integration,
 * checked 16 October 2026). The SDK is a script PayPal serves, not a package.
 */
export type PaymentSessionCallbacks = {
  readonly onApprove: (data: { orderId: string }) => Promise<void>;
  readonly onCancel: (data: { orderId?: string }) => void;
  readonly onError: (error: Error) => void;
};

export type PaymentSession = {
  start(options: { presentationMode: "auto" }, order: Promise<{ orderId: string }>): Promise<void>;
};

type Eligibility = {
  isEligible(method: "paypal" | "paylater"): boolean;
  getDetails(method: "paylater"): { productCode?: string; countryCode?: string };
};

export type PayPalSdk = {
  findEligibleMethods(options: { currencyCode: string }): Promise<Eligibility>;
  createPayPalOneTimePaymentSession(callbacks: PaymentSessionCallbacks): PaymentSession;
  createPayLaterOneTimePaymentSession(callbacks: PaymentSessionCallbacks): PaymentSession;
};

type PayPalNamespace = { createInstance(options: { clientId: string; components: string[]; pageType: string }): Promise<PayPalSdk> };

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

export type PayLater = { readonly productCode: string | undefined; readonly countryCode: string | undefined };

export type SdkState =
  | { readonly status: "loading" }
  | { readonly status: "unavailable" }
  | { readonly status: "ready"; readonly sdk: PayPalSdk; readonly paypal: boolean; readonly payLater: PayLater | null };

let script: Promise<PayPalNamespace> | null = null;

/** Adds PayPal's script to the page once, however many sheets ask for it. */
function loadScript(src: string): Promise<PayPalNamespace> {
  script ??= new Promise<PayPalNamespace>((resolve, reject) => {
    const element = document.createElement("script");
    element.src = src;
    element.async = true;
    element.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal's SDK did not start")));
    element.onerror = () => reject(new Error("PayPal's SDK could not be loaded"));
    document.head.append(element);
  }).catch((error: unknown) => {
    // A later sheet may try again, after a network blip.
    script = null;
    throw error;
  });
  return script;
}

/** Loads the SDK when `enabled`, and says which PayPal buttons the payer may use. */
export function usePayPalSdk(options: { enabled: boolean; src: string; clientId: string; currency: string }): SdkState {
  const { enabled, src, clientId, currency } = options;
  const [state, setState] = useState<SdkState>({ status: "loading" });
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    (async () => {
      const namespace = await loadScript(src);
      const sdk = await namespace.createInstance({ clientId, components: ["paypal-payments"], pageType: "checkout" });
      const methods = await sdk.findEligibleMethods({ currencyCode: currency });
      const payLater = methods.isEligible("paylater") ? methods.getDetails("paylater") : null;
      if (current) {
        setState({
          status: "ready",
          sdk,
          paypal: methods.isEligible("paypal"),
          payLater: payLater === null ? null : { productCode: payLater.productCode, countryCode: payLater.countryCode },
        });
      }
    })().catch(() => {
      if (current) setState({ status: "unavailable" });
    });
    return () => {
      current = false;
    };
  }, [enabled, src, clientId, currency]);
  return state;
}
