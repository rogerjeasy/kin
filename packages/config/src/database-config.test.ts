import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { hasDatabaseConfig, readDatabaseConfig } from "./database-config.ts";

const aurora = {
  KIN_DATABASE_HOST: "kin.cluster-abc.us-east-1.rds.amazonaws.com",
  KIN_DATABASE_APP_PASSWORD: "app-secret",
  KIN_DATABASE_PROVISIONER_PASSWORD: "provisioner-secret",
};

describe("the database settings", () => {
  it("are read for the roles asked for, with verified TLS by default", () => {
    expect(readDatabaseConfig(aurora, ["app", "provisioner"])).toEqual({
      host: "kin.cluster-abc.us-east-1.rds.amazonaws.com",
      port: 5432,
      database: "kin",
      tls: true,
      credentials: {
        app: { user: "kin_app", password: "app-secret" },
        provisioner: { user: "kin_provisioner", password: "provisioner-secret" },
      },
    });
  });

  it("name the connecting role by its fixed name, never from the environment", () => {
    const config = readDatabaseConfig({ ...aurora, KIN_DATABASE_APP_USER: "kin_admin" }, ["app"]);
    expect(config.credentials.app.user).toBe("kin_app");
  });

  it("refuse to start without a role's password", () => {
    expect(() => readDatabaseConfig(aurora, ["service"])).toThrow(/KIN_DATABASE_SERVICE_PASSWORD/);
    expect(() => readDatabaseConfig({ ...aurora, KIN_DATABASE_APP_PASSWORD: " " }, ["app"])).toThrow(ConfigError);
  });

  it("need the admin's user name only to migrate", () => {
    expect(() => readDatabaseConfig({ ...aurora, KIN_DATABASE_ADMIN_PASSWORD: "x" }, ["admin"])).toThrow(/ADMIN_USER/);
    const config = readDatabaseConfig({ ...aurora, KIN_DATABASE_ADMIN_PASSWORD: "x", KIN_DATABASE_ADMIN_USER: "kin_admin" }, ["admin"]);
    expect(config.credentials.admin).toEqual({ user: "kin_admin", password: "x" });
  });

  it("allow TLS off only for a database on this machine", () => {
    expect(readDatabaseConfig({ ...aurora, KIN_DATABASE_HOST: "localhost", KIN_DATABASE_TLS: "off" }, ["app"]).tls).toBe(false);
    expect(() => readDatabaseConfig({ ...aurora, KIN_DATABASE_TLS: "off" }, ["app"])).toThrow(/this machine/);
    expect(() => readDatabaseConfig({ ...aurora, KIN_DATABASE_TLS: "maybe" }, ["app"])).toThrow(ConfigError);
  });

  it("read a port and a database name, and refuse a port that is not one", () => {
    const config = readDatabaseConfig({ ...aurora, KIN_DATABASE_PORT: "54329", KIN_DATABASE_NAME: "kin_test" }, ["app"]);
    expect([config.port, config.database]).toEqual([54329, "kin_test"]);
    expect(() => readDatabaseConfig({ ...aurora, KIN_DATABASE_PORT: "99999" }, ["app"])).toThrow(/port/);
  });

  it("say whether a database is configured at all", () => {
    expect(hasDatabaseConfig(aurora)).toBe(true);
    expect(hasDatabaseConfig({})).toBe(false);
  });
});
