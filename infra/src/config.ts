/**
 * Typed configuration for Kin's infrastructure, read from cdk.json and the
 * environment and checked before any stack is built. Invalid configuration
 * stops the synth, so nothing half-configured reaches AWS.
 */
export type InfraConfig = {
  readonly account: string;
  readonly region: string;
  readonly availabilityZones: readonly string[];
  /** Where budget and dead-letter alerts are sent. */
  readonly alertEmail: string;
  /**
   * The Gmail account that sends Kin's sign-in email, or `null` to keep
   * Cognito's own sender. Setting it routes every Cognito email through
   * Kin's Gmail sender and turns on sign-in with a code by email. Set it only
   * after the app password is stored (`gmail:store`), or no code arrives.
   */
  readonly senderEmail: string | null;
  readonly monthlyBudgetUsd: number;
  /** Aurora Serverless v2 capacity. A minimum of zero lets it pause. */
  readonly databaseCapacityAcu: { readonly min: number; readonly max: number };
  /** Origins the sign-in flow may return to. */
  readonly webOrigins: readonly string[];
  /** The GitHub OIDC subject allowed to deploy: one repository, one branch. */
  readonly githubDeploySubject: string;
  /**
   * The other projects' IAM roles and users in this account, as patterns
   * after `arn:aws:iam::<account>:`, such as `role/wick-*`. Every Kin store
   * denies them explicitly, whatever their own policies allow.
   */
  readonly neighbourPrincipalPatterns: readonly string[];
  /**
   * The other projects' names, as they tag their resources (`project` or
   * `Project`) and begin their bucket names. Kin's deployments may not touch
   * them.
   */
  readonly neighbourProjects: readonly string[];
  /**
   * The pool's PayPal sandbox app, or `null` to leave top-ups off. Neither
   * value is secret: PayPal's client ID is meant for the browser, and the
   * webhook ID only names the webhook. The client secret is in Secrets
   * Manager (`paypal:store`). Both are required, because they switch on the
   * web app's top-ups and the worker that confirms them together: top-ups
   * with nobody to record them would take money the ledger never shows.
   */
  readonly paypal: { readonly clientId: string; readonly webhookId: string } | null;
  /**
   * Whether the web app may listen and speak through Amazon Transcribe and
   * Amazon Polly in this region. Off unless `kin:speech` is `true`.
   */
  readonly speech: boolean;
};

export class InfraConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InfraConfigError";
  }
}

type Source = {
  /** Reads a value from the CDK context (cdk.json or `-c key=value`). */
  readonly context: (key: string) => unknown;
  readonly env: Readonly<Record<string, string | undefined>>;
};

const ACU_STEP = 0.5;
const MAX_ACU = 256;

export function readConfig({ context, env }: Source): InfraConfig {
  const region = text(context("kin:region"), "kin:region");
  const capacity = context("kin:databaseCapacityAcu");
  return {
    account: account(env["CDK_DEFAULT_ACCOUNT"]),
    region,
    availabilityZones: [`${region}a`, `${region}b`],
    alertEmail: email(context("kin:alertEmail") ?? env["KIN_ALERT_EMAIL"], ALERT_EMAIL_HINT),
    senderEmail: optionalEmail(context("kin:senderEmail") ?? env["KIN_SENDER_EMAIL"], SENDER_EMAIL_HINT),
    monthlyBudgetUsd: positive(context("kin:monthlyBudgetUsd"), "kin:monthlyBudgetUsd"),
    databaseCapacityAcu: acuRange(capacity),
    webOrigins: texts(context("kin:webOrigins"), "kin:webOrigins"),
    githubDeploySubject: text(context("kin:githubDeploySubject"), "kin:githubDeploySubject"),
    neighbourPrincipalPatterns: texts(context("kin:neighbourPrincipalPatterns"), "kin:neighbourPrincipalPatterns"),
    neighbourProjects: texts(context("kin:neighbourProjects"), "kin:neighbourProjects"),
    paypal: paypalApp(context("kin:paypal")),
    speech: flag(context("kin:speech"), "kin:speech"),
  };
}

function flag(value: unknown, key: string): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value !== "boolean") throw new InfraConfigError(`${key} must be true or false`);
  return value;
}

function paypalApp(value: unknown): InfraConfig["paypal"] {
  const key = "kin:paypal";
  if (value === undefined || value === null) return null;
  if (typeof value !== "object") throw new InfraConfigError(`${key} must be { "clientId": string, "webhookId": string }`);
  const { clientId, webhookId } = value as Record<string, unknown>;
  return { clientId: text(clientId, `${key}.clientId`), webhookId: text(webhookId, `${key}.webhookId`) };
}

function account(value: unknown): string {
  if (typeof value !== "string" || !/^\d{12}$/.test(value)) {
    throw new InfraConfigError(
      "No AWS account. Run the CDK with an AWS profile, for example AWS_PROFILE=wick-dev.",
    );
  }
  return value;
}

const ALERT_EMAIL_HINT = "Set an alert email with -c kin:alertEmail=you@example.com or KIN_ALERT_EMAIL.";
const SENDER_EMAIL_HINT = "The sender email (kin:senderEmail or KIN_SENDER_EMAIL) must be an email address, or unset.";

function email(value: unknown, hint: string): string {
  if (typeof value !== "string" || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) {
    throw new InfraConfigError(hint);
  }
  return value;
}

function optionalEmail(value: unknown, hint: string): string | null {
  if (value === undefined || value === "") return null;
  return email(value, hint);
}

function text(value: unknown, key: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new InfraConfigError(`${key} must be a non-empty string`);
  }
  return value;
}

function texts(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InfraConfigError(`${key} must be a non-empty list`);
  }
  return value.map((item: unknown) => text(item, key));
}

function positive(value: unknown, key: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new InfraConfigError(`${key} must be a number above zero`);
  }
  return value;
}

function acuRange(value: unknown): InfraConfig["databaseCapacityAcu"] {
  const key = "kin:databaseCapacityAcu";
  if (typeof value !== "object" || value === null) {
    throw new InfraConfigError(`${key} must be { "min": number, "max": number }`);
  }
  const { min, max } = value as Record<string, unknown>;
  const valid = (acu: unknown): acu is number =>
    typeof acu === "number" && acu >= 0 && acu <= MAX_ACU && acu % ACU_STEP === 0;
  if (!valid(min) || !valid(max) || max < Math.max(min, ACU_STEP)) {
    throw new InfraConfigError(
      `${key} needs min and max in steps of ${ACU_STEP} up to ${MAX_ACU}, with max at least ${ACU_STEP} and no less than min`,
    );
  }
  return { min, max };
}
