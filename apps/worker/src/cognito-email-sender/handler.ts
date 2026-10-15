import { signInEmail, type EmailSender } from "@kin/notify";

import { EMAIL_KIND_OF_TRIGGER, InvalidEventError, maskEmail, parseCognitoEmailEvent } from "./event.ts";

export type EmailSenderDependencies = {
  /**
   * Decrypts a code Cognito encrypted with Kin's key, and refuses one that
   * was not encrypted for this user pool.
   */
  decrypt(encryptedCode: string, userPoolId: string): Promise<string>;
  /** The sender, opened once and reused while the function stays warm. */
  sender(): Promise<EmailSender>;
  log(entry: Record<string, string>): void;
};

/**
 * Cognito's custom email sender: it hands Kin every code it would have
 * emailed, encrypted, and Kin delivers it. A failure is thrown, never
 * swallowed, so Cognito reports that the code could not be sent.
 */
export function createEmailSenderHandler(dependencies: EmailSenderDependencies) {
  return async (raw: unknown): Promise<void> => {
    const event = parseCognitoEmailEvent(raw);
    const kind = EMAIL_KIND_OF_TRIGGER[event.triggerSource];
    if (!kind) {
      dependencies.log({ outcome: "not_sent", triggerSource: event.triggerSource, to: maskEmail(event.email) });
      return;
    }
    if (event.encryptedCode === null) {
      throw new InvalidEventError(`${event.triggerSource} carries no code`);
    }
    const secret = await dependencies.decrypt(event.encryptedCode, event.userPoolId);
    // Cognito HTML-escapes reserved characters in temporary passwords.
    const readable = kind === "temporary_password" ? unescapeHtml(secret) : secret;
    const sender = await dependencies.sender();
    await sender.send({ to: event.email, ...signInEmail(kind, readable) });
    dependencies.log({ outcome: "sent", triggerSource: event.triggerSource, to: maskEmail(event.email) });
  };
}

const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&amp;": "&", "&quot;": '"', "&#39;": "'" };

function unescapeHtml(text: string): string {
  return text.replace(/&(lt|gt|amp|quot|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}
