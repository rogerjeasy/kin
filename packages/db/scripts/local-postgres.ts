// Kin's PostgreSQL for local development, in Docker: `pnpm db:up` and
// `pnpm db:down`. The data stays in a named volume between runs. The
// settings and passwords come from the root .env (see .env.example).
import { execFileSync } from "node:child_process";

import { readDatabaseConfig } from "@kin/config";

import { POSTGRES_IMAGE } from "../src/testing/postgres-container.ts";

const CONTAINER = "kin-postgres";
const VOLUME = "kin-postgres";

const docker = (args: string[]) => execFileSync("docker", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function running(): boolean {
  return docker(["ps", "--quiet", "--filter", `name=^${CONTAINER}$`]) !== "";
}

async function up(): Promise<void> {
  const config = readDatabaseConfig(process.env, ["admin"]);
  if (config.host !== "localhost" && config.host !== "127.0.0.1") {
    throw new Error(`KIN_DATABASE_HOST is ${config.host}; db:up only starts a database on this machine`);
  }
  if (!running()) {
    docker([
      "run", "--detach", "--rm", "--name", CONTAINER,
      "--publish", `127.0.0.1:${config.port}:5432`,
      "--volume", `${VOLUME}:/var/lib/postgresql/data`,
      "--env", `POSTGRES_USER=${config.credentials.admin.user}`,
      "--env", `POSTGRES_PASSWORD=${config.credentials.admin.password}`,
      "--env", `POSTGRES_DB=${config.database}`,
      POSTGRES_IMAGE,
    ]);
  }
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      docker(["exec", CONTAINER, "pg_isready", "--host", "127.0.0.1", "--username", config.credentials.admin.user, "--dbname", config.database]);
      console.log(`PostgreSQL is up on localhost:${config.port}`);
      return;
    } catch (error) {
      if (Date.now() > deadline) throw new Error("PostgreSQL did not become ready within a minute", { cause: error });
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

function down(): void {
  if (running()) docker(["stop", CONTAINER]);
  console.log("PostgreSQL is stopped. Its data is kept in the volume kin-postgres.");
}

const command = process.argv[2];
if (command === "up") await up();
else if (command === "down") down();
else throw new Error("Use: local-postgres.ts up | down");
