/**
 * Where KinData leaves what the database's users need, for KinWeb and the
 * deploy pipeline to read by name. Parameters, not cross-stack outputs, like
 * the sign-in settings (web-settings.ts).
 */
export const DATABASE_SETTINGS = {
  host: "kin-database-host",
  appSecretArn: "kin-database-app-secret-arn",
  provisionerSecretArn: "kin-database-provisioner-secret-arn",
  /** Read by KinWorker only. The web app never holds the service role. */
  serviceSecretArn: "kin-database-service-secret-arn",
  keyArn: "kin-database-key-arn",
  /** Not the database's, but read the same way: the key that signs demo sessions. */
  demoSessionKeyArn: "kin-web-demo-session-key-arn",
  servicesSubnets: "kin-services-subnets",
  servicesSecurityGroup: "kin-services-security-group",
} as const;

/** Where KinData leaves what the top-ups need, for KinWeb and KinWorker to read by name. */
export const PAYPAL_SETTINGS = {
  /** The pool app's client secret. `pnpm --filter @kin/infra run paypal:store` fills it. */
  secretName: "kin/paypal/client-secret",
  secretArn: "kin-paypal-client-secret-arn",
  inboxUrl: "kin-paypal-inbox-url",
  inboxArn: "kin-paypal-inbox-arn",
} as const;

/**
 * Where KinData leaves what Kin's phone call to a parent needs, for KinVoice,
 * KinWorker and KinWeb to read by name. The first two are slots a person
 * fills (`pnpm --filter @kin/infra run twilio:store`); the state key is
 * generated and never leaves Secrets Manager, so the worker that seals a
 * call's token and the voice service that opens it read the same value.
 */
export const TWILIO_SETTINGS = {
  accountSidSecretName: "kin/twilio/account-sid",
  accountSidSecretArn: "kin-twilio-account-sid-arn",
  authTokenSecretName: "kin/twilio/auth-token",
  authTokenSecretArn: "kin-twilio-auth-token-arn",
  stateKeySecretName: "kin/voice/state-key",
  stateKeySecretArn: "kin-voice-state-key-arn",
} as const;

/**
 * App Runner allows one VPC connector for a given network and security group, so the phone service
 * shares the web app's: KinWeb publishes it here and KinVoice reads it, and so deploys after it.
 */
export const SHARED_CONNECTOR = { arn: "kin-web-vpc-connector-arn" } as const;

/** The roles Kin connects as (packages/db/migrations/0001_security.sql). */
export const DATABASE_ROLES = ["app", "service", "provisioner"] as const;

export type DatabaseRole = (typeof DATABASE_ROLES)[number];

/** The one-off task that migrates the database before the web app rolls out. */
export const MIGRATION_TASK = {
  cluster: "kin",
  family: "kin-database-migrate",
  container: "migrate",
  executionRole: "kin-database-migrate-execution",
  taskRole: "kin-database-migrate-task",
} as const;
