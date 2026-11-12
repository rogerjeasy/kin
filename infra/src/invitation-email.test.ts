import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { buildKin, type KinStacks } from "./app.ts";
import { invitationEmailSettings, type InfraConfig } from "./config.ts";

const config: InfraConfig = {
  account: "123456789012",
  region: "us-east-1",
  availabilityZones: ["us-east-1a", "us-east-1b"],
  alertEmail: "alerts@example.com",
  senderEmail: null,
  monthlyBudgetUsd: 150,
  databaseCapacityAcu: { min: 0, max: 4 },
  webOrigins: ["http://localhost:3000"],
  githubDeploySubject: "repo:owner@1/kin@2:ref:refs/heads/main",
  neighbourPrincipalPatterns: ["role/wick-*", "user/carecircle-*"],
  neighbourProjects: ["wick", "carecircle"],
  paypal: { clientId: "sandbox-client-id", webhookId: "WH-SANDBOX" },
  speech: false,
  claude: false,
  demoSandboxPayeeEmail: null,
  demoInvoiceRecipientEmail: null,
  voice: false,
  voicePublicUrl: null,
  twilioCallerNumber: null,
  twilioSmsFrom: null,
  presenceLineNumbers: null,
  demoMerchant: false,
  agStudioLicense: null,
};

const cdkJson = JSON.parse(readFileSync(new URL("../cdk.json", import.meta.url), "utf8")) as { context: Record<string, unknown> };
// No asset staging and no bundling: the tests read templates only.
const context = { ...cdkJson.context, "aws:cdk:disable-asset-staging": true, "aws:cdk:bundling-stacks": [] };
const build = (overrides: Partial<InfraConfig>): KinStacks => buildKin(new App({ context }), { ...config, ...overrides });

type Container = { Environment: { Name: string; Value: unknown }[]; Secrets: { Name: string; ValueFrom: unknown }[] };
function workerContainer(built: KinStacks): Container {
  if (built.worker === null) throw new Error("The test configuration has a PayPal app, so KinWorker exists");
  const [task] = Object.values(Template.fromStack(built.worker).findResources("AWS::ECS::TaskDefinition"));
  return task?.["Properties"]["ContainerDefinitions"][0] as Container;
}

const ORIGIN = "https://abc123.us-east-1.awsapprunner.com";
const SENDER = "kin.family@gmail.com";

// Each build synthesizes every stack, so they are made once, before the tests run.
const on = build({ senderEmail: SENDER, webOrigins: ["http://localhost:3000", ORIGIN] });
const before = workerContainer(build({}));
const partials = [build({ senderEmail: SENDER }), build({ webOrigins: ["http://localhost:3000", ORIGIN] })];

describe("the invitation email", () => {
  it("is sent by the worker only with Kin's Gmail sender and the web app's https address", () => {
    const container = workerContainer(on);
    expect(container.Environment).toContainEqual({ Name: "KIN_SENDER_EMAIL", Value: SENDER });
    expect(container.Environment).toContainEqual({ Name: "KIN_WEB_PUBLIC_URL", Value: ORIGIN });
    expect(container.Secrets.map((secret) => secret.Name)).toContain("KIN_GMAIL_APP_PASSWORD");
    // The sender alone, or the address alone, leaves the worker as it was: nothing to send from, or a link that leads nowhere.
    for (const partial of partials) expect(workerContainer(partial)).toEqual(before);
    expect(JSON.stringify(before)).not.toMatch(/GMAIL|SENDER_EMAIL/);
  });

  it("reads the app password from the secret KinData publishes by name, and gives the worker read of that secret only", () => {
    if (on.worker === null) throw new Error("KinWorker exists");
    const worker = Template.fromStack(on.worker);
    expect(JSON.stringify(worker.toJSON())).toContain("kin-gmail-app-password-arn");
    Template.fromStack(on.data).hasResourceProperties("AWS::SSM::Parameter", { Name: "kin-gmail-app-password-arn" });
    const statements = Object.values(worker.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"]["PolicyDocument"]["Statement"] as { Action: string | string[]; Resource: unknown }[],
    );
    const reads = statements.filter((statement) => [statement.Action].flat().some((action) => action.startsWith("secretsmanager:")));
    expect(reads.every((statement) => !JSON.stringify(statement.Resource).includes('"*"'))).toBe(true);
    expect(statements.some((statement) => [statement.Action].flat().some((action) => action.startsWith("ses:") || action === "*"))).toBe(false);
  });

  it("settings need the worker, the sender and an https origin together", () => {
    expect(invitationEmailSettings({ ...config, senderEmail: SENDER, webOrigins: [ORIGIN] })).toEqual({ senderEmail: SENDER, webUrl: ORIGIN });
    expect(invitationEmailSettings({ ...config, senderEmail: SENDER, webOrigins: [ORIGIN], paypal: null })).toBeNull();
    expect(invitationEmailSettings({ ...config, senderEmail: SENDER, webOrigins: ["http://kin.example.com", `${ORIGIN}/app`] })).toBeNull();
  });
});
