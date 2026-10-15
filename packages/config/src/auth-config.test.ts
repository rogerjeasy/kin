import { describe, expect, it } from "vitest";

import { readAuthConfig } from "./auth-config.ts";
import { ConfigError } from "./config-error.ts";

const cognito = {
  KIN_AUTH_ISSUER: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YpsJatkpa",
  KIN_AUTH_LOGIN_URL: "https://kin-123.auth.us-east-1.amazoncognito.com",
  KIN_AUTH_CLIENT_ID: "client-1",
  KIN_WEB_ORIGIN: "https://kin.example",
};

describe("the sign-in settings", () => {
  it("are read from the environment, with the signing keys under the issuer", () => {
    expect(readAuthConfig(cognito)).toEqual({
      issuer: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YpsJatkpa",
      jwksUri: "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YpsJatkpa/.well-known/jwks.json",
      loginUrl: "https://kin-123.auth.us-east-1.amazoncognito.com",
      clientId: "client-1",
      webOrigin: "https://kin.example",
    });
  });

  it.each(Object.keys(cognito))("refuse to start without %s", (name) => {
    expect(() => readAuthConfig({ ...cognito, [name]: undefined })).toThrow(ConfigError);
    expect(() => readAuthConfig({ ...cognito, [name]: "  " })).toThrow(ConfigError);
  });

  it("refuse plain http anywhere but the machine's own address", () => {
    expect(() => readAuthConfig({ ...cognito, KIN_AUTH_ISSUER: "http://issuer.example/pool" })).toThrow(/https/);
    expect(() => readAuthConfig({ ...cognito, KIN_WEB_ORIGIN: "http://kin.example" })).toThrow(/https/);
    expect(readAuthConfig({ ...cognito, KIN_AUTH_ISSUER: "http://localhost:3101" }).issuer).toBe("http://localhost:3101");
  });

  it("refuse an origin with a path, a query or credentials", () => {
    expect(() => readAuthConfig({ ...cognito, KIN_WEB_ORIGIN: "https://kin.example/app" })).toThrow(/origin/);
    expect(() => readAuthConfig({ ...cognito, KIN_AUTH_LOGIN_URL: "https://login.example/?x=1" })).toThrow(ConfigError);
    expect(() => readAuthConfig({ ...cognito, KIN_AUTH_ISSUER: "https://user:pw@issuer.example/p" })).toThrow(ConfigError);
  });

  it("refuse something that is not a URL", () => {
    expect(() => readAuthConfig({ ...cognito, KIN_AUTH_ISSUER: "cognito" })).toThrow(/not a URL/);
  });
});
