import { readDatabaseConfig } from "@kin/config";
import { connect, type Database } from "@kin/db";

import { demoConfig } from "./demo-config";

type Pools = { readonly app: Database; readonly provisioner: Database | null };


let pools: Pools | undefined;

/**
 * Aurora stays at zero capacity and pauses when idle (architecture decision
 * 43). The first request after a pause waits for it to resume, which took 74
 * seconds on 15 October 2026; App Runner allows a request 120.
 */
const CONNECT_TIMEOUT_MS = 90_000;

/**
 * The database pools this server connects with, opened the first time a
 * request needs them and never at build time. The web server is a person's
 * agent, so it holds only `kin_app`, plus the provisioner when the demo is
 * on. It never holds the service role.
 */
export function databases(): Pools {
  if (!pools) {
    if (demoConfig().enabled) {
      const config = readDatabaseConfig(process.env, ["app", "provisioner"]);
      pools = {
        app: connect(config, "app", { connectTimeoutMs: CONNECT_TIMEOUT_MS }),
        provisioner: connect(config, "provisioner", { connectTimeoutMs: CONNECT_TIMEOUT_MS }),
      };
    } else {
      pools = { app: connect(readDatabaseConfig(process.env, ["app"]), "app", { connectTimeoutMs: CONNECT_TIMEOUT_MS }), provisioner: null };
    }
  }
  return pools;
}
