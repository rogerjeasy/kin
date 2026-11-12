import { currency, linkTo, problem, report, signIn } from "./client.ts";

/**
 * Step one of the saved-wallet check (architecture section 8.6): the demo
 * pharmacy asks to save a PayPal wallet for charges made without its owner
 * present. Someone signs in as the wallet's owner (the pool's business
 * account, or with `CONSUMER` a personal sandbox account such as Rose's) and
 * approves once, at the link this prints.
 */
export async function startVault(customerType: "BUSINESS" | "CONSUMER" = "BUSINESS"): Promise<void> {
  const merchant = await signIn("merchant");
  const setup = await merchant.call("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        usage_type: "MERCHANT",
        customer_type: customerType,
        description: "Kin family pool: repeat prescriptions",
        permit_multiple_payment_tokens: false,
        experience_context: {
          brand_name: "Kin demo pharmacy",
          return_url: "https://example.com/kin/vault/return",
          cancel_url: "https://example.com/kin/vault/cancel",
        },
      },
    },
  });
  report("Setup token created by the pharmacy", setup.status, setup.status < 300
    ? {
        id: setup.json["id"],
        status: setup.json["status"],
        approve: linkTo(setup.json, "approve"),
      }
    : problem(setup.json));
}

/**
 * Step two, once the pool has approved: turn the approval into a saved
 * wallet, then charge it once as the pharmacy, with nobody signing in.
 */
export async function finishVault(setupTokenId: string): Promise<void> {
  const merchant = await signIn("merchant");
  const saved = await merchant.call("POST", "/v3/vault/payment-tokens", {
    payment_source: { token: { id: setupTokenId, type: "SETUP_TOKEN" } },
  });
  report("Saved wallet", saved.status, saved.status < 300
    ? { vault_id: saved.json["id"], customer: saved.json["customer"] }
    : problem(saved.json));
  const vaultId = saved.json["id"];
  if (typeof vaultId !== "string") {
    return;
  }

  const order = await merchant.call("POST", "/v2/checkout/orders", {
    intent: "CAPTURE",
    purchase_units: [
      {
        description: "Blood pressure refill (sandbox check)",
        amount: { currency_code: currency, value: "1.00" },
      },
    ],
    payment_source: { paypal: { vault_id: vaultId } },
  });
  report("Charge with nobody signing in", order.status, order.status < 300
    ? {
        id: order.json["id"],
        status: order.json["status"],
        captures: (
          (order.json["purchase_units"] as Record<string, unknown>[] | undefined) ?? []
        ).map((unit) => (unit["payments"] as Record<string, unknown> | undefined)?.["captures"]),
      }
    : problem(order.json));
}

/**
 * Saves a sandbox test card as Rose's payment method with the demo pharmacy,
 * with no browser step: a card needs no payer approval, so the setup token
 * reads back `APPROVED` at once. Prints the vault ID to store as
 * `KIN_MERCHANT_PAYPAL_VAULT_ID`; the number is PayPal's public test Visa,
 * which only the sandbox accepts.
 */
export async function saveTestCard(): Promise<void> {
  const merchant = await signIn("merchant");
  const setup = await merchant.call("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      card: {
        number: "4111111111111111",
        expiry: "2030-12",
        name: "Rose (Kin demo)",
        billing_address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" },
        experience_context: { return_url: "https://example.com/kin/vault/return", cancel_url: "https://example.com/kin/vault/cancel" },
      },
    },
  });
  report("Card setup token", setup.status, setup.status < 300 ? { id: setup.json["id"], status: setup.json["status"] } : problem(setup.json));
  const setupId = setup.json["id"];
  if (setup.status >= 300 || typeof setupId !== "string") return;
  const saved = await merchant.call("POST", "/v3/vault/payment-tokens", { payment_source: { token: { id: setupId, type: "SETUP_TOKEN" } } });
  const card = (saved.json["payment_source"] as Record<string, Record<string, unknown>> | undefined)?.["card"];
  report("Saved card (store vault_id as KIN_MERCHANT_PAYPAL_VAULT_ID)", saved.status, saved.status < 300 ? { vault_id: saved.json["id"], brand: card?.["brand"], last_digits: card?.["last_digits"] } : problem(saved.json));
}
