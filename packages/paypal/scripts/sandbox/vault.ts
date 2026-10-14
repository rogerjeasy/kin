import { currency, linkTo, problem, report, signIn } from "./client.ts";

/**
 * Step one of the saved-wallet check (architecture section 8.6): the demo
 * pharmacy asks to save the pool's PayPal wallet for charges made without
 * the pool present. Someone signs in as the pool's business account and
 * approves once, at the link this prints.
 */
export async function startVault(): Promise<void> {
  const merchant = await signIn("merchant");
  const setup = await merchant.call("POST", "/v3/vault/setup-tokens", {
    payment_source: {
      paypal: {
        usage_type: "MERCHANT",
        customer_type: "BUSINESS",
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
