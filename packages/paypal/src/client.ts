import { optionalRecord, optionalText, requiredText, asRecord } from "./json.ts";
import { PayPalError } from "./paypal-error.ts";

export type Fetch = (input: string, init: RequestInit) => Promise<Response>;

/** One line per call to PayPal, with its debug ID and never a credential. */
export type PayPalCallLog = { readonly operation: string; readonly status: number | null; readonly debugId: string | null; readonly attempt: number };

export type PayPalClientOptions = {
  /** `https://api-m.sandbox.paypal.com`, or a stand-in in tests. */
  readonly apiUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
  readonly fetch: Fetch;
  readonly now: () => Date;
  readonly sleep: (ms: number) => Promise<void>;
  readonly log: (call: PayPalCallLog) => void;
};

export type PayPalRequest = {
  readonly method: "GET" | "PATCH" | "POST";
  readonly path: string;
  /** The request body exactly as sent, so a webhook's bytes are never re-encoded. */
  readonly body?: string;
  /** PayPal's idempotency key. Every write carries one, so a retry cannot repeat it. */
  readonly requestId?: string;
  /** A name for the log line, such as `orders.capture`. */
  readonly operation: string;
};

export type PayPalClient = { readonly send: (request: PayPalRequest) => Promise<unknown> };

const ATTEMPTS = 3;
const FIRST_BACKOFF_MS = 200;
const TIMEOUT_MS = 15_000;
/** A token is renewed this long before PayPal says it expires. */
const TOKEN_MARGIN_MS = 60_000;

type Token = { readonly value: string; readonly expiresAt: number };

/**
 * Signs in to PayPal with an app's credentials, caches the access token until
 * shortly before it expires, and sends requests with retries. Network errors,
 * 429 and 5xx answers are retried with backoff and the same request ID; any
 * other 4xx is PayPal's answer and is never retried.
 */
export function createPayPalClient(options: PayPalClientOptions): PayPalClient {
  let token: Token | null = null;

  async function accessToken(): Promise<string> {
    if (token !== null && token.expiresAt - TOKEN_MARGIN_MS > options.now().getTime()) return token.value;
    const basic = Buffer.from(`${options.clientId}:${options.clientSecret}`).toString("base64");
    const json = await attempt({ method: "POST", path: "/v1/oauth2/token", body: "grant_type=client_credentials", operation: "oauth.token" }, {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    });
    const record = asRecord(json, "access token");
    const expiresIn = record["expires_in"];
    token = {
      value: requiredText(record, "access_token"),
      expiresAt: options.now().getTime() + (typeof expiresIn === "number" ? expiresIn * 1000 : 0),
    };
    return token.value;
  }

  async function attempt(request: PayPalRequest, headers: Record<string, string>): Promise<unknown> {
    let lastStatus: number | null = null;
    let lastDebugId: string | null = null;
    for (let tryNumber = 1; tryNumber <= ATTEMPTS; tryNumber += 1) {
      if (tryNumber > 1) await options.sleep(FIRST_BACKOFF_MS * 2 ** (tryNumber - 2));
      let response: Response;
      let text: string;
      try {
        response = await options.fetch(`${options.apiUrl}${request.path}`, {
          method: request.method,
          headers: { Accept: "application/json", ...headers },
          body: request.body,
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        // Reading the body is part of the attempt: the timeout can fire here too.
        text = await response.text();
      } catch {
        options.log({ operation: request.operation, status: null, debugId: null, attempt: tryNumber });
        lastStatus = null;
        continue;
      }
      lastStatus = response.status;
      lastDebugId = response.headers.get("paypal-debug-id");
      options.log({ operation: request.operation, status: response.status, debugId: lastDebugId, attempt: tryNumber });
      if (response.ok) {
        // A success Kin cannot read is not proof of anything: asked again with
        // the same request ID, PayPal repeats its answer and does nothing twice.
        if (text === "") return {};
        const parsed = safeParse(text);
        if (parsed !== null) return parsed;
        continue;
      }
      if (response.status !== 429 && response.status < 500) {
        const problem = optionalRecord(text === "" ? null : safeParse(text));
        throw new PayPalError({ outcome: "rejected", status: response.status, issue: issueOf(problem), debugId: lastDebugId, operation: request.operation, resource: resourceOf(problem) });
      }
    }
    throw new PayPalError({ outcome: "unavailable", status: lastStatus, issue: null, debugId: lastDebugId, operation: request.operation });
  }

  return {
    async send(request) {
      const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json" };
      if (request.requestId !== undefined) headers["PayPal-Request-Id"] = request.requestId;
      try {
        return await attempt(request, headers);
      } catch (error) {
        // A token PayPal no longer accepts is renewed once.
        if (!(error instanceof PayPalError) || error.status !== 401) throw error;
        token = null;
        return attempt(request, { ...headers, Authorization: `Bearer ${await accessToken()}` });
      }
    },
  };
}

/** The most specific name PayPal gave the problem: a detail's issue, else the error's name. */
function issueOf(problem: ReturnType<typeof optionalRecord>): string | null {
  const details = problem?.["details"];
  const first = Array.isArray(details) ? optionalRecord(details[0]) : null;
  return optionalText(first, "issue") ?? optionalText(problem, "name") ?? optionalText(problem, "error");
}

/** Where PayPal's first detail points, such as the payout a repeated batch ID already made. */
function resourceOf(problem: ReturnType<typeof optionalRecord>): string | null {
  const details = problem?.["details"];
  const first = Array.isArray(details) ? optionalRecord(details[0]) : null;
  const links = first?.["link"];
  return Array.isArray(links) ? optionalText(optionalRecord(links[0]), "href") : null;
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}
