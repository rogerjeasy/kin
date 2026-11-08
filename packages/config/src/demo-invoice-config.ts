import { ConfigError } from "./config-error.ts";

export const DEMO_INVOICE_ENV = { recipient: "KIN_DEMO_INVOICE_RECIPIENT_EMAIL" } as const;

/**
 * PayPal's sandbox gives its personal test accounts addresses on this domain.
 * Nothing sent there reaches a real person.
 */
const SANDBOX_PERSONAL = /^[^@\s]+@personal\.example\.com$/;

type Env = Readonly<Record<string, string | undefined>>;

/**
 * The sandbox personal account that stands in for a demo circle's member when
 * the demo asks for money by PayPal invoice, or `null` when none is set (the
 * demo's invoices are then simulated). Only a PayPal sandbox personal address
 * is accepted, so a demo can never email a real person, and it comes from the
 * deployment's settings, never from what a visitor types.
 */
export function readDemoInvoiceRecipient(env: Env): string | null {
  const value = env[DEMO_INVOICE_ENV.recipient]?.trim().toLowerCase() ?? "";
  if (value === "") return null;
  if (!SANDBOX_PERSONAL.test(value)) {
    throw new ConfigError(`${DEMO_INVOICE_ENV.recipient} must be a PayPal sandbox personal account (…@personal.example.com)`);
  }
  return value;
}
