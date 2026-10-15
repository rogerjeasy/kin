/** Why Cognito needs a code delivered, in Kin's own terms. */
export const SIGN_IN_EMAIL_KINDS = ["confirm_sign_up", "sign_in", "reset_password", "verify_email", "temporary_password"] as const;

export type SignInEmailKind = (typeof SIGN_IN_EMAIL_KINDS)[number];

export type EmailMessage = { readonly subject: string; readonly text: string };

const OPENINGS: Record<SignInEmailKind, { subject: string; line: (secret: string) => string }> = {
  confirm_sign_up: { subject: "Your Kin code", line: (code) => `Your code to confirm your email address for Kin is ${code}.` },
  sign_in: { subject: "Your Kin sign-in code", line: (code) => `Your code to sign in to Kin is ${code}.` },
  reset_password: { subject: "Reset your Kin password", line: (code) => `Your code to reset your Kin password is ${code}.` },
  verify_email: { subject: "Confirm your new email address", line: (code) => `Your code to confirm your new email address for Kin is ${code}.` },
  temporary_password: {
    subject: "Your Kin account",
    line: (password) => `Your temporary Kin password is ${password}. You will choose your own when you first sign in.`,
  },
};

// Kin's one rule for the family (docs/project-description.md section 6.6):
// Kin tells, and never asks for a secret.
const CLOSING = [
  "Type it on Kin's sign-in page. Kin will never ask you for this code by phone, by message or by email.",
  "If you did not ask for it, you can ignore this email. Nothing changes until the code is used.",
].join("\n\n");

/** The plain-text email that carries a sign-in code or a temporary password. */
export function signInEmail(kind: SignInEmailKind, secret: string): EmailMessage {
  if (secret.trim() === "") {
    throw new Error("A sign-in email needs the code it carries");
  }
  const opening = OPENINGS[kind];
  return { subject: opening.subject, text: `${opening.line(secret)}\n\n${CLOSING}\n\nKin\n` };
}
