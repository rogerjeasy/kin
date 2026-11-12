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
  /**
   * Whether the web app may ask Claude on Amazon Bedrock in this region. Off
   * unless `kin:claude` is `true`: Bedrock decides per account which models
   * it serves, so switch it on only once the model in `@kin/config` answers.
   */
  readonly claude: boolean;
  /**
   * Kin's own PayPal sandbox personal account, or `null` to keep every demo
   * payout simulated. Set, the worker pays an approved demo caregiver payout
   * through PayPal's sandbox to this account and no other, and the web app
   * says so. Needs `kin:paypal`, since only the worker pays.
   */
  readonly demoSandboxPayeeEmail: string | null;
  /**
   * Whether the phone service (apps/voice) runs on App Runner as KinVoice.
   * Off unless `kin:voice` is `true`. Switching it on creates the service
   * and nothing else: Kin places no call until the Twilio credentials are
   * stored (`twilio:store`) and the worker's call loop is on (below).
   */
  readonly voice: boolean;
  /**
   * The https address App Runner gave KinVoice, or `null` before the first
   * deployment has named it (the same two steps as `kin:webOrigins`). Twilio
   * signs the address it calls, so the service and the worker must both hold
   * exactly this one. Needs `kin:voice`.
   */
  readonly voicePublicUrl: string | null;
  /**
   * Kin's own Twilio number, in E.164 form: the caller ID of its call to a
   * parent. A number is personal data of the account, so it is not committed:
   * `kin:twilioCallerNumber` or, in the pipeline, KIN_TWILIO_CALLER_NUMBER.
   * Needs `kin:paypal` (the worker exists only with it) and `kin:voice`.
   */
  readonly twilioCallerNumber: string | null;
  /**
   * The number, or the messaging service SID (`MG...`), the web app's "Text
   * it" button sends from: `kin:twilioSmsFrom` or KIN_TWILIO_SMS_FROM. Unset,
   * the button is not shown.
   */
  readonly twilioSmsFrom: string | null;
  /**
   * The numbers a parent rings to ask "is it really you?", as the JSON the phone service reads
   * (`KIN_PRESENCE_LINE_NUMBERS`, an object of E.164 number to circle): `kin:presenceLineNumbers` or, in the pipeline,
   * KIN_PRESENCE_LINE_NUMBERS. A number of its own, never the office line's. Unset, the presence line is off.
   * Needs `kin:voice`.
   */
  readonly presenceLineNumbers: string | null;
};

/**
 * Kin's call to a parent about a shift is placed by the worker, which needs
 * the phone service's address and a number to call from. Given only when the
 * worker, the phone service, the number and the address all exist, so a
 * half-set deployment places no call it could not have answered
 * (`readShiftCallConfig` in `@kin/config` refuses the same).
 */
export function shiftCallSettings(config: InfraConfig): { readonly callerNumber: string; readonly publicUrl: string } | null {
  const { paypal, voice, twilioCallerNumber, voicePublicUrl } = config;
  if (paypal === null || !voice || twilioCallerNumber === null || voicePublicUrl === null) return null;
  return { callerNumber: twilioCallerNumber, publicUrl: voicePublicUrl };
}

/**
 * The texts Kin sends a family member for "is it really you?" come from the worker, which needs Twilio's account, a sender
 * and the web app's public address, where the link in the text leads. Given only when all three exist, so a half-set
 * deployment queues the messages rather than sending a link that leads nowhere (`readPresenceTextConfig` in
 * `@kin/config` refuses the same).
 */
export function presenceTextSettings(config: InfraConfig): { readonly from: string; readonly webUrl: string } | null {
  const webUrl = config.webOrigins.find((origin) => /^https:\/\/[^\s/?#@]+$/.test(origin));
  if (config.paypal === null || config.twilioSmsFrom === null || webUrl === undefined) return null;
  return { from: config.twilioSmsFrom, webUrl };
}

/**
 * The invitation email comes from the worker, through the Gmail account that sends sign-in codes, and links to the web
 * app's public address. Given only when the worker, a sender and an https address all exist, so a half-set deployment
 * queues the invitations rather than emailing a link that leads nowhere (`readInvitationEmailConfig` in `@kin/config`
 * refuses the same). The person still joins at sign-in either way.
 */
export function invitationEmailSettings(config: InfraConfig): { readonly senderEmail: string; readonly webUrl: string } | null {
  const webUrl = config.webOrigins.find((origin) => /^https:\/\/[^\s/?#@]+$/.test(origin));
  if (config.paypal === null || config.senderEmail === null || webUrl === undefined) return null;
  return { senderEmail: config.senderEmail, webUrl };
}

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
    claude: flag(context("kin:claude"), "kin:claude"),
    demoSandboxPayeeEmail: demoSandboxPayee(context("kin:demoSandboxPayeeEmail"), context("kin:paypal")),
    ...twilio({ context, env }),
  };
}

function twilio({ context, env }: Source): Pick<InfraConfig, "voice" | "voicePublicUrl" | "twilioCallerNumber" | "twilioSmsFrom" | "presenceLineNumbers"> {
  const voice = flag(context("kin:voice"), "kin:voice");
  const voicePublicUrl = optionalVoiceUrl(context("kin:voicePublicUrl"));
  const twilioCallerNumber = optionalPhoneNumber(context("kin:twilioCallerNumber") ?? env["KIN_TWILIO_CALLER_NUMBER"], CALLER_NUMBER_HINT);
  const twilioSmsFrom = optionalSmsFrom(context("kin:twilioSmsFrom") ?? env["KIN_TWILIO_SMS_FROM"]);
  if (voicePublicUrl !== null && !voice) throw new InfraConfigError("kin:voicePublicUrl needs kin:voice: there is no voice service to name");
  if (twilioCallerNumber !== null && !voice) throw new InfraConfigError("The Twilio caller number needs kin:voice: the call is answered by the voice service");
  const paypal = context("kin:paypal");
  if (twilioCallerNumber !== null && (paypal === undefined || paypal === null)) {
    throw new InfraConfigError("The Twilio caller number needs kin:paypal: only the worker places the call, and it exists only with the PayPal app");
  }
  const presenceLineNumbers = optionalPresenceNumbers(context("kin:presenceLineNumbers") ?? env["KIN_PRESENCE_LINE_NUMBERS"]);
  if (presenceLineNumbers !== null && !voice) throw new InfraConfigError("The presence line's numbers need kin:voice: the line is answered by the voice service");
  return { voice, voicePublicUrl, twilioCallerNumber, twilioSmsFrom, presenceLineNumbers };
}

const CALLER_NUMBER_HINT = "The Twilio caller number (kin:twilioCallerNumber or KIN_TWILIO_CALLER_NUMBER) must be a phone number in E.164 form such as +15551234567, or unset.";
const E164 = /^\+[1-9][0-9]{6,14}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;

function optionalPhoneNumber(value: unknown, hint: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !E164.test(value)) throw new InfraConfigError(hint);
  return value;
}

/**
 * The presence line's numbers as the phone service reads them: a JSON object from E.164 number to a circle's UUID, or to
 * `{circleId, locale}`. Checked here only for shape, so a typo stops the deploy rather than the service at start-up; the
 * service checks it again. Given as an object in cdk.json or as JSON text in the environment, and passed on as JSON text.
 */
function optionalPresenceNumbers(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new InfraConfigError("kin:presenceLineNumbers (or KIN_PRESENCE_LINE_NUMBERS) is not JSON");
    }
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0 || !Object.keys(parsed).every((number) => E164.test(number))) {
    throw new InfraConfigError("kin:presenceLineNumbers must map phone numbers in E.164 form to circles");
  }
  return JSON.stringify(parsed);
}

function optionalSmsFrom(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !(E164.test(value) || MESSAGING_SERVICE_SID.test(value))) {
    throw new InfraConfigError("The text sender (kin:twilioSmsFrom or KIN_TWILIO_SMS_FROM) must be a phone number in E.164 form or a messaging service SID (MG and 32 hex characters), or unset.");
  }
  return value;
}

/** The same shape the worker and the phone service accept: https, a host, no path, no trailing slash, no underscore. */
function optionalVoiceUrl(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !/^https:\/\/[^\s/?#_@]+$/.test(value)) {
    throw new InfraConfigError("kin:voicePublicUrl must be the https address App Runner gave KinVoice, with no path and no trailing slash, or unset");
  }
  return value;
}

function demoSandboxPayee(value: unknown, paypal: unknown): string | null {
  const payee = optionalEmail(value ?? undefined, "kin:demoSandboxPayeeEmail must be the email of Kin's PayPal sandbox personal account, or unset.");
  if (payee !== null && (paypal === undefined || paypal === null)) {
    throw new InfraConfigError("kin:demoSandboxPayeeEmail needs kin:paypal: only the worker pays demo payouts through PayPal's sandbox");
  }
  return payee;
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
