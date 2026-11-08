import { readDemoInvoiceRecipient } from "@kin/config";

import { circleFormatters } from "@/content/circle/format";
import { circleSlots } from "@/content/circle/words";
import { getDictionary } from "@/i18n/dictionary";
import { defaultLocale } from "@/i18n/locales";
import { fill } from "@/i18n/template";
import { circleJsonRoute } from "@/server/circle-json-route";
import { databases } from "@/server/database";
import { runInvoiceRequest } from "@/server/invoice-requests";
import { topUpServices } from "@/server/paypal";

const MAX_BODY = 1_000;

/**
 * Requests for money by PayPal invoice: `{ operation: "request", id, memberId, purpose: "settlement" }`,
 * `{ operation: "request", id, memberId, purpose: "top_up", amount }`, or `{ operation: "cancel" | "check", id }`.
 */
export function POST(request: Request): Promise<Response> {
  return circleJsonRoute(request, { maxBytes: MAX_BODY, label: "invoice_request" }, async ({ viewer, circle }, input) => {
    const { invoicing } = await getDictionary(defaultLocale);
    const slots = circleSlots(circle, circleFormatters(defaultLocale, circle));
    return runInvoiceRequest(
      {
        db: databases().app,
        userId: viewer.userId,
        circle,
        services: topUpServices(),
        demoRecipient: readDemoInvoiceRecipient(process.env),
        words: {
          item: (purpose) => fill(purpose === "settlement" ? invoicing.item.settlement : invoicing.item.topUp, slots),
          note: invoicing.note,
          cancelNote: invoicing.cancelNote,
        },
      },
      input,
    );
  });
}
