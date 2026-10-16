import type { Page } from "@playwright/test";

/** What the stand-in PayPal window does once opened: the payer approves, or closes it. */
export type PayerChoice = "approve" | "cancel";

/**
 * A stand-in for PayPal's JavaScript SDK v6, served where the real one is, so
 * the sheet's flow runs with no network and no PayPal account. It keeps the
 * contract Kin relies on: `start` receives the order promise, and the session
 * calls `onApprove` with the order's ID or `onCancel`. PayPal's own window is
 * PayPal's to test; this checks Kin's side of it.
 */
export async function standInPayPal(page: Page, choice: PayerChoice): Promise<void> {
  await page.route("https://www.sandbox.paypal.com/web-sdk/v6/core", (route) =>
    route.fulfill({ contentType: "text/javascript", body: sdkSource(choice) }),
  );
}

function sdkSource(choice: PayerChoice): string {
  return `
    for (const name of ["paypal-button", "paypal-pay-later-button"]) {
      customElements.define(name, class extends HTMLElement {
        connectedCallback() {
          if (this.firstChild) return;
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = name === "paypal-button" ? "Pay with PayPal" : "Pay Later";
          button.style.width = "100%";
          button.style.minHeight = "44px";
          this.append(button);
        }
      });
    }
    const session = (callbacks) => ({
      async start(options, order) {
        const { orderId } = await order;
        if (${JSON.stringify(choice)} === "approve") await callbacks.onApprove({ orderId });
        else callbacks.onCancel({ orderId });
      },
    });
    window.paypal = {
      async createInstance() {
        return {
          async findEligibleMethods() {
            return { isEligible: (method) => method === "paypal", getDetails: () => ({}) };
          },
          createPayPalOneTimePaymentSession: session,
          createPayLaterOneTimePaymentSession: session,
        };
      },
    };
  `;
}
