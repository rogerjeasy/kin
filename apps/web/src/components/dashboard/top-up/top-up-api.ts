/** The browser's side of Kin's top-up routes. Every answer is checked before use. */

export class TopUpRefused extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Top-up refused: ${reason}`);
    this.name = "TopUpRefused";
    this.reason = reason;
  }
}

async function call(path: string, init: RequestInit): Promise<Record<string, unknown>> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json" }, cache: "no-store" });
  const body: unknown = await response.json().catch(() => ({}));
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  if (!response.ok) throw new TopUpRefused(typeof record["error"] === "string" ? record["error"] : String(response.status));
  return record;
}

export async function createTopUpOrder(amount: string, locale: string): Promise<{ orderId: string }> {
  const { orderId } = await call("/api/top-ups", { method: "POST", body: JSON.stringify({ amount, locale }) });
  if (typeof orderId !== "string") throw new TopUpRefused("paypal");
  return { orderId };
}

export async function captureTopUp(orderId: string): Promise<string | null> {
  const { captureId } = await call(`/api/top-ups/${encodeURIComponent(orderId)}/capture`, { method: "POST", body: "{}" });
  return typeof captureId === "string" ? captureId : null;
}

export async function isRecorded(captureId: string): Promise<boolean> {
  const { recorded } = await call(`/api/top-ups/captures/${encodeURIComponent(captureId)}`, { method: "GET" });
  return recorded === true;
}
