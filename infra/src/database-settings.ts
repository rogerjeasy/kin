/**
 * Where KinData leaves what the database's users need, for KinWeb and the
 * deploy pipeline to read by name. Parameters, not cross-stack outputs, like
 * the sign-in settings (web-settings.ts).
 */
export const DATABASE_SETTINGS = {
  host: "kin-database-host",
  appSecretArn: "kin-database-app-secret-arn",
  provisionerSecretArn: "kin-database-provisioner-secret-arn",
  keyArn: "kin-database-key-arn",
  /** Not the database's, but read the same way: the key that signs demo sessions. */
  demoSessionKeyArn: "kin-web-demo-session-key-arn",
  servicesSubnets: "kin-services-subnets",
  servicesSecurityGroup: "kin-services-security-group",
} as const;

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
