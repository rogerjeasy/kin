import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readDemoInvoiceRecipient } from "./demo-invoice-config.ts";

describe("the demo's invoice recipient", () => {
  it("is absent unless set, and the demo's invoices are then simulated", () => {
    expect(readDemoInvoiceRecipient({})).toBeNull();
    expect(readDemoInvoiceRecipient({ KIN_DEMO_INVOICE_RECIPIENT_EMAIL: "  " })).toBeNull();
  });

  it("is a PayPal sandbox personal account", () => {
    expect(readDemoInvoiceRecipient({ KIN_DEMO_INVOICE_RECIPIENT_EMAIL: " SB-Member123@Personal.Example.com " })).toBe("sb-member123@personal.example.com");
  });

  it("refuses any address that could reach a real person", () => {
    for (const address of ["someone@gmail.com", "pool@business.example.com", "x@personal.example.com.evil.test", "not an email"]) {
      expect(() => readDemoInvoiceRecipient({ KIN_DEMO_INVOICE_RECIPIENT_EMAIL: address })).toThrow(ConfigError);
    }
  });
});
