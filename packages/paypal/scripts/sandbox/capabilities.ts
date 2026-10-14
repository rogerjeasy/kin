import {
  currency,
  linkTo,
  pause,
  problem,
  report,
  runId,
  signIn,
  type Sandbox,
} from "./client.ts";

const SCOPES = {
  payouts: "https://uri.paypal.com/payments/payouts",
  subscriptions: "https://uri.paypal.com/services/subscriptions",
  invoicing: "https://uri.paypal.com/services/invoicing",
  vault: "https://uri.paypal.com/services/vault/payment-tokens/readwrite",
  balances: "https://uri.paypal.com/services/reporting/search/read",
} as const;

/** What the pool's app may do, its balance, a payout and a subscription. */
export async function checkCapabilities(payee: string | undefined): Promise<void> {
  const pool = await signIn("pool");
  console.log("Signed in as the pool's app. Features it holds:");
  for (const [feature, scope] of Object.entries(SCOPES)) {
    console.log(`  ${pool.scopes.includes(scope) ? "yes" : "NO "}  ${feature}`);
  }
  await checkBalance(pool);
  await checkPayout(pool, payee);
  await checkSubscription(pool);
}

export async function checkBalance(pool: Sandbox): Promise<void> {
  const balance = await pool.call("GET", `/v1/reporting/balances?currency_code=${currency}`);
  report("Pool balance", balance.status, balance.status < 300
    ? { balances: balance.json["balances"] }
    : problem(balance.json));
}

async function checkPayout(pool: Sandbox, payee: string | undefined): Promise<void> {
  if (!payee) {
    console.log("\nPayout: skipped. Pass a personal sandbox email to send 1.00 to it.");
    return;
  }
  const created = await pool.call("POST", "/v1/payments/payouts", {
    sender_batch_header: {
      sender_batch_id: runId,
      email_subject: "Kin sandbox check",
      recipient_type: "EMAIL",
    },
    items: [
      {
        amount: { value: "1.00", currency },
        receiver: payee,
        note: "Kin sandbox check, test money",
        sender_item_id: `${runId}-item`,
      },
    ],
  });
  const header = created.json["batch_header"] as Record<string, unknown> | undefined;
  report("Payout created", created.status, header ?? problem(created.json));
  const batchId = header?.["payout_batch_id"];
  if (typeof batchId !== "string") {
    return;
  }
  // Read it back rather than trust the creation response, as the ledger will.
  await pause(8000);
  const read = await pool.call("GET", `/v1/payments/payouts/${batchId}`);
  const items = (read.json["items"] as Record<string, unknown>[] | undefined) ?? [];
  report("Payout read back", read.status, {
    batch_status: (read.json["batch_header"] as Record<string, unknown> | undefined)?.["batch_status"],
    items: items.map((item) => ({
      transaction_status: item["transaction_status"],
      fee: item["payout_item_fee"],
      errors: item["errors"],
    })),
  });
}

async function checkSubscription(pool: Sandbox): Promise<void> {
  const product = await pool.call("POST", "/v1/catalogs/products", {
    name: "Kin family circle (sandbox check)",
    type: "SERVICE",
  });
  report("Product created", product.status, product.status < 300 ? { id: product.json["id"] } : problem(product.json));
  if (typeof product.json["id"] !== "string") {
    return;
  }
  const plan = await pool.call("POST", "/v1/billing/plans", {
    product_id: product.json["id"],
    name: "Monthly share (sandbox check)",
    billing_cycles: [
      {
        frequency: { interval_unit: "MONTH", interval_count: 1 },
        tenure_type: "REGULAR",
        sequence: 1,
        total_cycles: 0,
        pricing_scheme: { fixed_price: { value: "1.00", currency_code: currency } },
      },
    ],
    payment_preferences: { auto_bill_outstanding: true, payment_failure_threshold: 1 },
  });
  report("Plan created", plan.status, plan.status < 300 ? { id: plan.json["id"], status: plan.json["status"] } : problem(plan.json));
  if (typeof plan.json["id"] !== "string") {
    return;
  }
  const subscription = await pool.call("POST", "/v1/billing/subscriptions", {
    plan_id: plan.json["id"],
  });
  report("Subscription created", subscription.status, subscription.status < 300
    ? {
        id: subscription.json["id"],
        status: subscription.json["status"],
        approve: linkTo(subscription.json, "approve"),
      }
    : problem(subscription.json));
}
