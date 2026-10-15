import type { EmailMessage } from "./sign-in-email.ts";

/** Sends one email. Kin's code depends on this, never on a provider directly. */
export type EmailSender = {
  send(message: EmailMessage & { readonly to: string }): Promise<void>;
};

/** An email could not be sent. `retryable` says whether trying again can help. */
export class EmailDeliveryError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "EmailDeliveryError";
    this.retryable = retryable;
  }
}
