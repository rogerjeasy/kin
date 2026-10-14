import { problem, report, signIn } from "./client.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** A subscription's state and the payments PayPal has taken for it. */
export async function checkSubscriptionPayments(id: string): Promise<void> {
  const pool = await signIn("pool");
  const subscription = await pool.call("GET", `/v1/billing/subscriptions/${id}`);
  const billing = subscription.json["billing_info"] as Record<string, unknown> | undefined;
  report("Subscription", subscription.status, subscription.status < 300
    ? {
        status: subscription.json["status"],
        last_payment: billing?.["last_payment"],
        next_billing_time: billing?.["next_billing_time"],
        failed_payments_count: billing?.["failed_payments_count"],
      }
    : problem(subscription.json));

  const end = new Date();
  const start = new Date(end.getTime() - 7 * DAY_MS);
  const payments = await pool.call(
    "GET",
    `/v1/billing/subscriptions/${id}/transactions?start_time=${start.toISOString()}&end_time=${end.toISOString()}`,
  );
  const transactions = (payments.json["transactions"] as Record<string, unknown>[] | undefined) ?? [];
  report("Subscription payments", payments.status, payments.status < 300
    ? transactions.map((each) => ({
        id: each["id"],
        status: each["status"],
        amounts: each["amount_with_breakdown"],
        time: each["time"],
      }))
    : problem(payments.json));
}
