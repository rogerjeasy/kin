import { readDatabaseConfig } from "@kin/config";
import { connect, type Database } from "@kin/db";

import { demoConfig } from "./demo-config";

type Pools = { readonly app: Database; readonly provisioner: Database | null };


let pools: Pools | undefined;

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
      pools = { app: connect(config, "app"), provisioner: connect(config, "provisioner") };
    } else {
      pools = { app: connect(readDatabaseConfig(process.env, ["app"]), "app"), provisioner: null };
    }
  }
  return pools;
}
