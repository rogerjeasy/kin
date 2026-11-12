import type { AdminAddUserToGroupCommand, AdminGetUserCommand } from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it } from "vitest";

import type { GrantableAccountType } from "./account-groups.ts";
import { UngrantableAccountTypeError, cognitoAdmin } from "./cognito-admin.ts";
import { UserPoolError, userPoolOf } from "./user-pool.ts";

describe("the user pool, read from the issuer", () => {
  it("is Cognito's pool and region, called at Cognito's own endpoint", () => {
    expect(userPoolOf("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_YpsJatkpa")).toEqual({ region: "us-east-1", userPoolId: "us-east-1_YpsJatkpa", endpoint: "https://cognito-idp.us-east-1.amazonaws.com", hosted: true });
  });

  it("is a stand-in on this machine, and nothing else", () => {
    expect(userPoolOf("http://localhost:3101")).toMatchObject({ endpoint: "http://localhost:3101", hosted: false });
    expect(() => userPoolOf("https://issuer.example/us-east-1_abc")).toThrow(UserPoolError);
    expect(() => userPoolOf("http://cognito-idp.us-east-1.amazonaws.com/us-east-1_abc")).toThrow(UserPoolError);
  });
});

describe("granting an account type", () => {
  const pool = userPoolOf("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example1");

  it("adds the person to that group in Kin's pool", async () => {
    const sent: (AdminAddUserToGroupCommand | AdminGetUserCommand)[] = [];
    const groups = cognitoAdmin(pool, { send: async (command) => void sent.push(command) });
    await groups.grant("person-1", "caregiver");
    expect(sent.map((command) => command.input)).toEqual([{ UserPoolId: "us-east-1_Example1", Username: "person-1", GroupName: "caregiver" }]);
  });

  it("refuses any group Kin does not grant, even past the type checker", async () => {
    const sent: unknown[] = [];
    const groups = cognitoAdmin(pool, { send: async (command) => void sent.push(command) });
    for (const type of ["administrator", "professional", "Admins"]) {
      await expect(groups.grant("person-1", type as GrantableAccountType)).rejects.toBeInstanceOf(UngrantableAccountTypeError);
    }
    expect(sent).toEqual([]);
  });
});

describe("reading whether a person has an authenticator app", () => {
  const pool = userPoolOf("https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example1");

  it("asks Kin's pool about that person, with the web app's own identity rather than theirs", async () => {
    const sent: unknown[] = [];
    const admin = cognitoAdmin(pool, {
      send: async (command) => {
        sent.push(command.input);
        return { Username: "person-1", UserMFASettingList: ["SOFTWARE_TOKEN_MFA"] };
      },
    });
    await expect(admin.authenticatorEnabled("person-1")).resolves.toBe(true);
    expect(sent).toEqual([{ UserPoolId: "us-east-1_Example1", Username: "person-1" }]);
  });

  it("says no for an account with no second factor, or only another kind", async () => {
    for (const answer of [{}, { UserMFASettingList: [] }, { UserMFASettingList: ["SMS_MFA"] }, { UserMFASettingList: "SOFTWARE_TOKEN_MFA" }]) {
      await expect(cognitoAdmin(pool, { send: async () => answer }).authenticatorEnabled("person-1")).resolves.toBe(false);
    }
  });
});
