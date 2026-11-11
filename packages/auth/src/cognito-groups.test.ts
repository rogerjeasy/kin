import type { AdminAddUserToGroupCommand } from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it } from "vitest";

import type { GrantableAccountType } from "./account-groups.ts";
import { UngrantableAccountTypeError, cognitoAccountGroups } from "./cognito-groups.ts";
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
    const sent: AdminAddUserToGroupCommand[] = [];
    const groups = cognitoAccountGroups(pool, { send: async (command) => void sent.push(command) });
    await groups.grant("person-1", "caregiver");
    expect(sent.map((command) => command.input)).toEqual([{ UserPoolId: "us-east-1_Example1", Username: "person-1", GroupName: "caregiver" }]);
  });

  it("refuses any group Kin does not grant, even past the type checker", async () => {
    const sent: unknown[] = [];
    const groups = cognitoAccountGroups(pool, { send: async (command) => void sent.push(command) });
    for (const type of ["administrator", "professional", "Admins"]) {
      await expect(groups.grant("person-1", type as GrantableAccountType)).rejects.toBeInstanceOf(UngrantableAccountTypeError);
    }
    expect(sent).toEqual([]);
  });
});
