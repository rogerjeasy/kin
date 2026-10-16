import { ConfigError } from "./config-error.ts";
import { isLocalAddress } from "./local-address.ts";

export const INBOX_ENV = {
  /** The FIFO queue that carries PayPal's events from web to worker. */
  queueUrl: "KIN_PAYPAL_INBOX_URL",
  /** A stand-in for SQS on this machine (`pnpm queue:up`). Unset in AWS. */
  endpoint: "KIN_QUEUE_ENDPOINT",
  region: "AWS_REGION",
} as const;

export type InboxConfig = { readonly queueUrl: string; readonly region: string; readonly endpoint: string | null };

type Env = Readonly<Record<string, string | undefined>>;


/** Where PayPal's events wait for the worker, or `null` when no queue is set. */
export function readInboxConfig(env: Env): InboxConfig | null {
  const queueUrl = env[INBOX_ENV.queueUrl]?.trim() ?? "";
  if (queueUrl === "") return null;
  if (!queueUrl.endsWith(".fifo")) throw new ConfigError(`${INBOX_ENV.queueUrl} must be a FIFO queue, so one circle's events stay in order`);
  const endpoint = env[INBOX_ENV.endpoint]?.trim() || null;
  if (endpoint !== null && !isLocalAddress(endpoint)) throw new ConfigError(`${INBOX_ENV.endpoint} is only for a queue on this machine`);
  return { queueUrl, endpoint, region: env[INBOX_ENV.region]?.trim() || "us-east-1" };
}
