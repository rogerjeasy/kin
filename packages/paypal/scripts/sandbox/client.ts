/**
 * A minimal PayPal sandbox client for the day-one checks. It signs in with an
 * app's credentials and never prints a credential or a token.
 */

const API = "https://api-m.sandbox.paypal.com";

export type Json = Record<string, unknown>;

export type Sandbox = {
  readonly scopes: readonly string[];
  readonly call: (
    method: "GET" | "POST",
    path: string,
    body?: Json,
  ) => Promise<{ status: number; json: Json }>;
};

/** Which app to sign in as: the pool's, or the demo pharmacy's. */
export type App = "pool" | "merchant";

const CREDENTIALS: Record<App, { id: string; secret: string }> = {
  pool: { id: "PAYPAL_SANDBOX_CLIENT_ID", secret: "PAYPAL_SANDBOX_CLIENT_SECRET" },
  merchant: {
    id: "PAYPAL_SANDBOX_MERCHANT_CLIENT_ID",
    secret: "PAYPAL_SANDBOX_MERCHANT_CLIENT_SECRET",
  },
};

export const currency = process.env["PAYPAL_TRIAL_CURRENCY"] ?? "USD";

/** Unique per run, so request IDs and batch IDs never repeat by accident. */
export const runId = `kin-check-${Date.now()}`;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run with the repository's .env loaded.`);
  }
  return value;
}

export async function signIn(app: App): Promise<Sandbox> {
  const id = required(CREDENTIALS[app].id);
  const secret = required(CREDENTIALS[app].secret);
  const response = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const json = (await response.json()) as Json;
  const token = json["access_token"];
  if (!response.ok || typeof token !== "string") {
    throw new Error(
      `Sign-in to the sandbox as the ${app} app failed: HTTP ${response.status} ${String(json["error_description"] ?? "")}`,
    );
  }

  let requestNumber = 0;
  return {
    scopes: String(json["scope"] ?? "").split(" "),
    call: async (method, path, body) => {
      requestNumber += 1;
      const result = await fetch(`${API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          // Every write carries a request ID, so a retry cannot repeat it.
          "PayPal-Request-Id": `${runId}-${app}-${requestNumber}`,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      const text = await result.text();
      return { status: result.status, json: text ? (JSON.parse(text) as Json) : {} };
    },
  };
}

export function report(step: string, status: number, details: unknown): void {
  console.log(`\n${step}: HTTP ${status}`);
  console.log(JSON.stringify(details, null, 2));
}

/** The error PayPal returned, without echoing the whole response. */
export function problem(json: Json): Json {
  return { name: json["name"], message: json["message"], details: json["details"] };
}

export function linkTo(json: Json, rel: string): unknown {
  const links = (json["links"] as Json[] | undefined) ?? [];
  return links.find((link) => link["rel"] === rel)?.["href"];
}

export const pause = (ms: number) =>
  new Promise((resolve) => setTimeout(resolve, ms));
