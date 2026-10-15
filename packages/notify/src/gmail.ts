import nodemailer from "nodemailer";

import { EmailDeliveryError, type EmailSender } from "./email-sender.ts";

/** The Gmail account that sends Kin's sign-in email, signed in with a Google app password. */
export type GmailAccount = { readonly address: string; readonly appPassword: string };

type SendMail = (mail: { from: { name: string; address: string }; to: string; subject: string; text: string }) => Promise<unknown>;

/** Opens a connection to Gmail's mail server. Tests pass their own. */
export type GmailTransport = (account: GmailAccount) => { sendMail: SendMail };

const smtpTransport: GmailTransport = (account) =>
  nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: { user: account.address, pass: account.appPassword },
  });

/** Google shows app passwords in groups of four letters. The spaces are not part of it. */
export function normalizeAppPassword(raw: string): string {
  return raw.replace(/\s+/g, "");
}

/**
 * Sends email from a personal Gmail account. Gmail signs what it sends, so the
 * mail passes the recipient's sender checks.
 */
export function createGmailSender(account: GmailAccount, transport: GmailTransport = smtpTransport): EmailSender {
  const appPassword = normalizeAppPassword(account.appPassword);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(account.address) || appPassword === "") {
    throw new EmailDeliveryError("The Gmail sender needs an address and an app password", false);
  }
  const connection = transport({ address: account.address, appPassword });
  return {
    async send({ to, subject, text }) {
      try {
        await connection.sendMail({ from: { name: "Kin", address: account.address }, to, subject, text });
      } catch (error) {
        // A refused sign-in will not fix itself. Anything else may.
        const refused = typeof error === "object" && error !== null && "code" in error && error.code === "EAUTH";
        throw new EmailDeliveryError(refused ? "Gmail refused the app password" : "Gmail did not accept the email", !refused);
      }
    },
  };
}
