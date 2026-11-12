/** The secret that holds the Gmail account's app password. `gmail:store` fills it. */
export const GMAIL_SECRET_NAME = "kin/gmail-app-password";

/** Where KinData leaves that secret's ARN, for KinWorker to read by name: the worker emails invitations from the same account. */
export const GMAIL_SECRET_ARN_PARAMETER = "kin-gmail-app-password-arn";
