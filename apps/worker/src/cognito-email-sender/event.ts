import type { SignInEmailKind } from "@kin/notify";

/** What Cognito's custom email sender trigger delivers, read and checked. */
export type CognitoEmailEvent = {
  readonly triggerSource: string;
  readonly userPoolId: string;
  /** The code or temporary password, encrypted with Kin's key. Absent on some notices. */
  readonly encryptedCode: string | null;
  readonly email: string;
};

/** The kind of email each trigger asks for, or `null` for one Kin does not send. */
export const EMAIL_KIND_OF_TRIGGER: Record<string, SignInEmailKind | null> = {
  CustomEmailSender_SignUp: "confirm_sign_up",
  CustomEmailSender_ResendCode: "confirm_sign_up",
  CustomEmailSender_Authentication: "sign_in",
  CustomEmailSender_ForgotPassword: "reset_password",
  CustomEmailSender_UpdateUserAttribute: "verify_email",
  CustomEmailSender_VerifyUserAttribute: "verify_email",
  CustomEmailSender_AdminCreateUser: "temporary_password",
  // Kin does not run Cognito's threat protection, which sends these.
  CustomEmailSender_AccountTakeOverNotification: null,
};

export class InvalidEventError extends Error {
  readonly retryable = false;

  constructor(message: string) {
    super(message);
    this.name = "InvalidEventError";
  }
}

/** Reads the trigger's event, and refuses one that is not shaped as Cognito sends it. */
export function parseCognitoEmailEvent(raw: unknown): CognitoEmailEvent {
  if (typeof raw !== "object" || raw === null) throw new InvalidEventError("The event is not an object");
  const { triggerSource, userPoolId, request } = raw as Record<string, unknown>;
  if (typeof triggerSource !== "string" || !(triggerSource in EMAIL_KIND_OF_TRIGGER)) {
    throw new InvalidEventError("The event has an unknown trigger source");
  }
  if (typeof userPoolId !== "string" || userPoolId === "") throw new InvalidEventError("The event names no user pool");
  if (typeof request !== "object" || request === null) throw new InvalidEventError("The event has no request");
  const { code, userAttributes } = request as Record<string, unknown>;
  const attributes = typeof userAttributes === "object" && userAttributes !== null ? (userAttributes as Record<string, unknown>) : {};
  const { email } = attributes;
  if (typeof email !== "string" || !email.includes("@")) throw new InvalidEventError("The event has no email address");
  if (code !== undefined && code !== null && typeof code !== "string") throw new InvalidEventError("The event's code is malformed");
  return { triggerSource, userPoolId, encryptedCode: typeof code === "string" && code !== "" ? code : null, email };
}

/** An address as logs may show it: the first letter and the domain. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}
