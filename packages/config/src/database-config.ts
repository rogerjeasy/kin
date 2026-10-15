import { ConfigError } from "./config-error.ts";

/**
 * The database roles Kin connects as (packages/db/migrations/0001_security.sql).
 * Each process asks only for the roles it uses.
 */
export const DATABASE_ROLES = {
  admin: null,
  app: "kin_app",
  service: "kin_service",
  provisioner: "kin_provisioner",
} as const;

export type DatabaseRole = keyof typeof DATABASE_ROLES;

export type DatabaseCredentials = { readonly user: string; readonly password: string };

export type DatabaseConfig<R extends DatabaseRole = DatabaseRole> = {
  readonly host: string;
  readonly port: number;
  readonly database: string;
  /** Verified TLS. Off only for a database on the machine's own address. */
  readonly tls: boolean;
  readonly credentials: Readonly<Record<R, DatabaseCredentials>>;
};

/** The environment variables a `DatabaseConfig` is read from. */
export const DATABASE_ENV = {
  host: "KIN_DATABASE_HOST",
  port: "KIN_DATABASE_PORT",
  database: "KIN_DATABASE_NAME",
  tls: "KIN_DATABASE_TLS",
  adminUser: "KIN_DATABASE_ADMIN_USER",
  password: (role: DatabaseRole) => `KIN_DATABASE_${role.toUpperCase()}_PASSWORD`,
} as const;

type Env = Readonly<Record<string, string | undefined>>;

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_PORT = 5432;

/** Reads where the database is and the credentials of the roles asked for. */
export function readDatabaseConfig<R extends DatabaseRole>(env: Env, roles: readonly R[]): DatabaseConfig<R> {
  const host = required(env, DATABASE_ENV.host);
  const tls = readTls(env, host);
  const credentials = Object.fromEntries(
    roles.map((role) => [role, { user: userOf(env, role), password: required(env, DATABASE_ENV.password(role)) }]),
  ) as Record<R, DatabaseCredentials>;
  return { host, port: readPort(env), database: env[DATABASE_ENV.database]?.trim() || "kin", tls, credentials };
}

/** Whether the environment names a database at all. */
export function hasDatabaseConfig(env: Env): boolean {
  return Boolean(env[DATABASE_ENV.host]?.trim());
}

function userOf(env: Env, role: DatabaseRole): string {
  const fixed = DATABASE_ROLES[role];
  return fixed ?? required(env, DATABASE_ENV.adminUser);
}

function readPort(env: Env): number {
  const raw = env[DATABASE_ENV.port]?.trim();
  if (!raw) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError(`${DATABASE_ENV.port} is not a port number`);
  }
  return port;
}

function readTls(env: Env, host: string): boolean {
  const raw = env[DATABASE_ENV.tls]?.trim() || "require";
  if (raw === "require") return true;
  if (raw === "off" && LOCAL_HOSTS.has(host)) return false;
  if (raw === "off") throw new ConfigError(`${DATABASE_ENV.tls} may be off only for a database on this machine`);
  throw new ConfigError(`${DATABASE_ENV.tls} must be require or off`);
}

function required(env: Env, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new ConfigError(`${name} is not set`);
  return value;
}
