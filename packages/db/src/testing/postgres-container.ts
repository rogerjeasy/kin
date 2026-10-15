import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import type { DatabaseConfig, DatabaseRole } from "@kin/config";

/** The engine Aurora runs (infra/src/database.ts), so tests meet the same SQL. */
export const POSTGRES_IMAGE = "postgres:17.9-alpine";

const READY_TIMEOUT_MS = 60_000;

export type PostgresContainer = {
  readonly config: DatabaseConfig;
  stop(): void;
};

const secret = () => randomBytes(18).toString("base64url");

type Credentials = Record<DatabaseRole, { user: string; password: string }>;

/** Fresh random passwords for every role. */
export function randomCredentials(): Credentials {
  return {
    admin: { user: "postgres", password: secret() },
    app: { user: "kin_app", password: secret() },
    service: { user: "kin_service", password: secret() },
    provisioner: { user: "kin_provisioner", password: secret() },
  };
}

/**
 * Starts a throwaway PostgreSQL in Docker, on a free port unless one is
 * given, with fresh random passwords unless they are given. Nothing outlives
 * the test run.
 */
export async function startPostgres(options: { port?: number; credentials?: Credentials } = {}): Promise<PostgresContainer> {
  const credentials = options.credentials ?? randomCredentials();
  const name = `kin-db-test-${randomBytes(4).toString("hex")}`;
  const publish = `127.0.0.1:${options.port ?? ""}:5432`;
  docker(["run", "--detach", "--rm", "--name", name, "--publish", publish, "--env", `POSTGRES_USER=${credentials.admin.user}`, "--env", `POSTGRES_PASSWORD=${credentials.admin.password}`, "--env", "POSTGRES_DB=kin", POSTGRES_IMAGE]);
  const stop = () => {
    docker(["stop", "--time", "1", name]);
  };
  try {
    const port = Number(docker(["port", name, "5432/tcp"]).trim().split(":").at(-1));
    await waitUntilReady(name, credentials.admin.user);
    return { config: { host: "127.0.0.1", port, database: "kin", tls: false, credentials }, stop };
  } catch (error) {
    stop();
    throw error;
  }
}

async function waitUntilReady(name: string, user: string): Promise<void> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  // The image restarts the server once after creating the database, so the
  // check asks for a real query over TCP rather than the first socket.
  while (Date.now() < deadline) {
    try {
      docker(["exec", name, "psql", "--host", "127.0.0.1", "--username", user, "--dbname", "kin", "--command", "select 1"]);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error(`PostgreSQL in ${name} was not ready within ${READY_TIMEOUT_MS / 1000} seconds`);
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}
