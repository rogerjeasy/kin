import { App, CliCredentialsStackSynthesizer } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ACCOUNT_TYPES } from "@kin/auth";

import { buildKin } from "./app.ts";
import type { InfraConfig } from "./config.ts";
import { QUEUES } from "./queues.ts";

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
};

// The same feature flags as a real synth, so the tests see what is deployed.
const cdkJson = JSON.parse(
  readFileSync(new URL("../cdk.json", import.meta.url), "utf8"),
) as { context: Record<string, unknown> };
// Asset staging copies the repository for the web image. The tests read
// templates only, so they skip it.
const testContext = { ...cdkJson.context, "aws:cdk:disable-asset-staging": true };
const stacks = buildKin(new App({ context: testContext }), config);
const data = Template.fromStack(stacks.data);
const network = Template.fromStack(stacks.network);
const ci = Template.fromStack(stacks.ci);
const ops = Template.fromStack(stacks.ops);
const web = Template.fromStack(stacks.web);
if (stacks.worker === null) throw new Error("The test configuration has a PayPal app, so KinWorker exists");
const worker = Template.fromStack(stacks.worker);
const all = [data, network, ci, ops, web, worker];
// The web app as it is before top-ups are configured. Its settings and
// permissions are pinned here; what top-ups add is pinned under "top-ups".
const webBefore = Template.fromStack(buildKin(new App({ context: testContext }), { ...config, paypal: null }).web);

const neighbourDeny = expect.objectContaining({
  Effect: "Deny",
  Condition: {
    ArnLike: {
      "aws:PrincipalArn": [
        "arn:aws:iam::123456789012:role/wick-*",
        "arn:aws:iam::123456789012:user/carecircle-*",
      ],
    },
  },
});

function policyStatements(
  template: Template,
  type: string,
  documentKey: string,
): unknown[] {
  return Object.values(template.findResources(type)).map(
    (resource) => resource["Properties"][documentKey]["Statement"],
  );
}

const keyId = () =>
  Object.keys(data.findResources("AWS::KMS::Key"))[0] ?? "missing";

describe("Kin's place in the shared account", () => {
  it("names every named resource kin, and nothing after another project", () => {
    const nameKeys = [
      "BucketName",
      "QueueName",
      "TopicName",
      "RoleName",
      "UserPoolName",
      "ClientName",
      "GroupName",
      "DBClusterIdentifier",
      "BudgetName",
      "AliasName",
      "ManagedPolicyName",
      "Name",
    ];
    for (const template of all) {
      const json = JSON.stringify(template.toJSON());
      expect(json).not.toMatch(/"(wick|hold|carecircle|zeitzeuge)[-_]/i);
      for (const resource of Object.values(template.toJSON()["Resources"] as Record<string, { Properties?: Record<string, unknown> }>)) {
        for (const key of nameKeys) {
          const name = resource.Properties?.[key];
          if (typeof name === "string") {
            expect(name).toMatch(/^(kin|alias\/kin|family_member|caregiver|professional|administrator)/);
          }
        }
      }
    }
  });

  it("denies the other projects' roles on every bucket, queue, secret and the key", () => {
    const statements = [
      ...policyStatements(data, "AWS::S3::BucketPolicy", "PolicyDocument"),
      ...policyStatements(data, "AWS::SQS::QueuePolicy", "PolicyDocument"),
      ...policyStatements(data, "AWS::SecretsManager::ResourcePolicy", "ResourcePolicy"),
      ...policyStatements(data, "AWS::KMS::Key", "KeyPolicy"),
    ];

    // Two buckets, ten queues, seven secrets (the database admin's, the Gmail
    // app password, the three database roles' passwords, the demo session
    // key and the PayPal client secret) and the key.
    expect(statements).toHaveLength(2 + 10 + 7 + 1);
    for (const statement of statements) {
      expect(statement).toEqual(expect.arrayContaining([neighbourDeny]));
    }
  });

  it("creates no GitHub OIDC provider, because the account's one is shared", () => {
    for (const template of all) {
      template.resourceCountIs("Custom::AWSCDKOpenIdConnectProvider", 0);
      template.resourceCountIs("AWS::IAM::OIDCProvider", 0);
    }
  });

  it("adds at most one Lambda function to an account with a small concurrency quota", () => {
    const functions = all.reduce(
      (sum, template) =>
        sum + Object.keys(template.findResources("AWS::Lambda::Function")).length,
      0,
    );
    expect(functions).toBeLessThanOrEqual(1);
  });
});

describe("the demo", () => {
  it("signs visitors' sessions with a generated key kept in Secrets Manager", () => {
    data.hasResourceProperties("AWS::SecretsManager::Secret", {
      Name: "kin/web/demo-session-key",
      KmsKeyId: { "Fn::GetAtt": [keyId(), "Arn"] },
      GenerateSecretString: { PasswordLength: 64, ExcludePunctuation: true },
    });
  });
});

describe("the database's users", () => {
  it("each have a generated password of their own, kept if the stack goes", () => {
    for (const role of ["app", "service", "provisioner"]) {
      data.hasResourceProperties("AWS::SecretsManager::Secret", {
        Name: `kin/database/${role}`,
        KmsKeyId: { "Fn::GetAtt": [keyId(), "Arn"] },
        GenerateSecretString: { PasswordLength: 40, ExcludePunctuation: true },
      });
    }
    const roleSecrets = Object.values(data.findResources("AWS::SecretsManager::Secret")).filter((secret) =>
      /^kin\/database\/(app|service|provisioner)$/.test(String(secret["Properties"]["Name"])),
    );
    expect(roleSecrets.map((secret) => secret["DeletionPolicy"])).toEqual(["Retain", "Retain", "Retain"]);
  });

  it("are set up by a one-off migration task, not a Lambda function", () => {
    data.hasResourceProperties("AWS::ECS::TaskDefinition", {
      Family: "kin-database-migrate",
      RequiresCompatibilities: ["FARGATE"],
      ContainerDefinitions: [
        Match.objectLike({
          Name: "migrate",
          Environment: Match.arrayWith([{ Name: "KIN_DATABASE_TLS", Value: "require" }]),
          Secrets: Match.arrayWith([
            Match.objectLike({ Name: "KIN_DATABASE_ADMIN_PASSWORD" }),
            Match.objectLike({ Name: "KIN_DATABASE_APP_PASSWORD" }),
            Match.objectLike({ Name: "KIN_DATABASE_SERVICE_PASSWORD" }),
            Match.objectLike({ Name: "KIN_DATABASE_PROVISIONER_PASSWORD" }),
          ]),
        }),
      ],
    });
    data.hasResourceProperties("AWS::ECS::Cluster", { ClusterName: "kin" });
    data.resourceCountIs("AWS::Lambda::Function", 0);
  });

  it("give the migration task no AWS access of its own", () => {
    const [taskRole] = Object.entries(data.findResources("AWS::IAM::Role")).filter(([, role]) => role["Properties"]["RoleName"] === "kin-database-migrate-task");
    expect(taskRole).toBeDefined();
    const attached = Object.values(data.findResources("AWS::IAM::Policy")).filter((policy) =>
      JSON.stringify(policy["Properties"]["Roles"]).includes(taskRole?.[0] ?? "missing"),
    );
    expect(attached).toEqual([]);
  });
});

describe("the database", () => {
  it("is encrypted with Kin's key, protected from deletion and kept in the isolated subnets", () => {
    data.hasResourceProperties("AWS::RDS::DBCluster", {
      Engine: "aurora-postgresql",
      StorageEncrypted: true,
      KmsKeyId: { "Fn::GetAtt": [keyId(), "Arn"] },
      DeletionProtection: true,
      ServerlessV2ScalingConfiguration: { MinCapacity: 0, MaxCapacity: 4 },
    });
    data.hasResource("AWS::RDS::DBCluster", { DeletionPolicy: "Snapshot" });
    data.hasResourceProperties("AWS::RDS::DBSubnetGroup", {
      SubnetIds: Match.arrayWith([
        {
          "Fn::GetStackOutput": Match.objectLike({
            StackName: "KinNetwork",
            OutputName: Match.stringLikeRegexp("Vpcdatabase"),
          }),
        },
      ]),
    });
  });

  it("admits only Kin's services, on the PostgreSQL port", () => {
    data.resourceCountIs("AWS::EC2::SecurityGroupIngress", 1);
    data.hasResourceProperties("AWS::EC2::SecurityGroupIngress", {
      FromPort: 5432,
      ToPort: 5432,
      SourceSecurityGroupId: {
        "Fn::GetStackOutput": Match.objectLike({
          StackName: "KinNetwork",
          OutputName: Match.stringLikeRegexp("Services"),
        }),
      },
    });
  });
});

describe("the buckets", () => {
  it("are private, versioned, encrypted with Kin's key and retained", () => {
    const buckets = data.findResources("AWS::S3::Bucket");
    expect(Object.keys(buckets)).toHaveLength(2);
    for (const bucket of Object.values(buckets)) {
      expect(bucket["DeletionPolicy"]).toBe("Retain");
      expect(bucket["Properties"]).toMatchObject({
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: true,
          BlockPublicPolicy: true,
          IgnorePublicAcls: true,
          RestrictPublicBuckets: true,
        },
        VersioningConfiguration: { Status: "Enabled" },
        BucketEncryption: {
          ServerSideEncryptionConfiguration: [
            expect.objectContaining({
              ServerSideEncryptionByDefault: {
                SSEAlgorithm: "aws:kms",
                KMSMasterKeyID: { "Fn::GetAtt": [keyId(), "Arn"] },
              },
            }),
          ],
        },
      });
    }
  });

  it("refuse any request that is not over TLS", () => {
    for (const statement of policyStatements(data, "AWS::S3::BucketPolicy", "PolicyDocument")) {
      expect(statement).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            Effect: "Deny",
            Condition: { Bool: { "aws:SecureTransport": "false" } },
          }),
        ]),
      );
    }
  });
});

describe("the queues", () => {
  it("give each queue a dead-letter queue with an alarm", () => {
    const names = Object.keys(QUEUES);
    data.resourceCountIs("AWS::SQS::Queue", names.length * 2);
    data.resourceCountIs("AWS::CloudWatch::Alarm", names.length);
    for (const name of names) {
      data.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: Match.stringLikeRegexp(`^kin-${name}(\\.fifo)?$`),
        RedrivePolicy: Match.objectLike({ maxReceiveCount: 5 }),
        KmsMasterKeyId: { "Fn::GetAtt": [keyId(), "Arn"] },
      });
    }
  });

  it("keep per-circle order on the queues that need it", () => {
    for (const [name, settings] of Object.entries(QUEUES)) {
      data.hasResourceProperties("AWS::SQS::Queue", {
        QueueName: settings.ordered ? `kin-${name}.fifo` : `kin-${name}`,
        FifoQueue: settings.ordered ? true : Match.absent(),
      });
    }
  });
});

describe("sign-in", () => {
  it("is Kin's own pool, protected from deletion, with one group per account type", () => {
    data.resourceCountIs("AWS::Cognito::UserPool", 1);
    data.hasResourceProperties("AWS::Cognito::UserPool", {
      UserPoolName: "kin-people",
      DeletionProtection: "ACTIVE",
      MfaConfiguration: "OPTIONAL",
    });
    for (const groupName of ACCOUNT_TYPES) {
      data.hasResourceProperties("AWS::Cognito::UserPoolGroup", { GroupName: groupName });
    }
  });

  it("has a public client with no secret, using the authorization code flow", () => {
    data.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      GenerateSecret: false,
      AllowedOAuthFlows: ["code"],
      CallbackURLs: ["http://localhost:3000/auth/callback"],
    });
  });

  it("shows the web client Kin's own branded pages, not Cognito's default style", () => {
    data.resourceCountIs("AWS::Cognito::ManagedLoginBranding", 1);
    data.hasResourceProperties("AWS::Cognito::ManagedLoginBranding", {
      UseCognitoProvidedValues: false,
      Settings: Match.objectLike({
        categories: Match.objectLike({ global: Match.objectLike({ colorSchemeMode: "DYNAMIC" }) }),
      }),
      Assets: Match.arrayWith([
        Match.objectLike({ Category: "FORM_LOGO", ColorMode: "LIGHT", Extension: "SVG" }),
        Match.objectLike({ Category: "FORM_LOGO", ColorMode: "DARK", Extension: "SVG" }),
      ]),
    });
  });
});

describe("sign-in with a code by email", () => {
  it("stays off, with Cognito's own sender and passwords only, until a Gmail sender is set", () => {
    data.hasResourceProperties("AWS::Cognito::UserPool", {
      LambdaConfig: Match.absent(),
      Policies: Match.objectLike({ SignInPolicy: Match.absent() }),
    });
    data.hasResourceProperties("AWS::Cognito::UserPoolClient", {
      ExplicitAuthFlows: Match.not(Match.arrayWith(["ALLOW_USER_AUTH"])),
    });
    data.resourceCountIs("AWS::Lambda::Function", 0);
  });

  it("keeps a secret slot for the Gmail app password, so it can be stored before the switch", () => {
    data.hasResourceProperties("AWS::SecretsManager::Secret", { Name: "kin/gmail-app-password", KmsKeyId: Match.anyValue() });
  });

  describe("once a Gmail sender is set", () => {
    const withSender = Template.fromStack(
      buildKin(
        // Bundling the function is skipped here. The synth and the deploy bundle it.
        new App({ context: { ...testContext, "aws:cdk:bundling-stacks": [] } }),
        { ...config, senderEmail: "kin.family@gmail.com" },
      ).data,
    );

    it("hands every code to Kin's sender, encrypted with Kin's key, and offers the code beside the password", () => {
      withSender.hasResourceProperties("AWS::Cognito::UserPool", {
        EmailConfiguration: Match.absent(),
        LambdaConfig: {
          CustomEmailSender: { LambdaArn: Match.anyValue(), LambdaVersion: "V1_0" },
          KMSKeyID: Match.anyValue(),
        },
        Policies: Match.objectLike({ SignInPolicy: { AllowedFirstAuthFactors: ["PASSWORD", "EMAIL_OTP"] } }),
        MfaConfiguration: "OPTIONAL",
      });
      withSender.hasResourceProperties("AWS::Cognito::UserPoolClient", { ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_AUTH"]) });
      withSender.hasResourceProperties("AWS::Cognito::UserPoolClient", { ExplicitAuthFlows: Match.arrayWith(["ALLOW_USER_SRP_AUTH"]) });
    });

    it("runs the sender with the address, the secret and the key, and no code in its settings", () => {
      withSender.hasResourceProperties("AWS::Lambda::Function", {
        FunctionName: "kin-sign-in-email",
        Runtime: "nodejs22.x",
        Environment: {
          Variables: {
            KIN_SENDER_EMAIL: "kin.family@gmail.com",
            KIN_GMAIL_SECRET_ARN: Match.anyValue(),
            KIN_CODES_KEY_ARN: Match.anyValue(),
          },
        },
      });
    });

    it("lets the sender decrypt only codes encrypted for Kin's user pool", () => {
      const statements = Object.values(withSender.findResources("AWS::IAM::Policy")).flatMap(
        (policy) => policy["Properties"]["PolicyDocument"]["Statement"] as Record<string, unknown>[],
      );
      const decrypts = statements.filter((statement) => [statement["Action"]].flat().includes("kms:Decrypt"));
      const unscoped = decrypts.filter((statement) => {
        const condition = JSON.stringify(statement["Condition"] ?? {});
        return !condition.includes("kms:EncryptionContext:userpool-id") && !condition.includes("kms:ViaService");
      });

      expect(decrypts.some((statement) => JSON.stringify(statement["Condition"]).includes("kms:EncryptionContext:userpool-id"))).toBe(true);
      expect(unscoped).toEqual([]);
    });
  });
});

describe("the web app", () => {
  it("runs on App Runner from Kin's image, small and capped at two instances", () => {
    web.hasResourceProperties("AWS::AppRunner::Service", {
      ServiceName: "kin-web",
      InstanceConfiguration: { Cpu: "1 vCPU", Memory: "2 GB" },
      HealthCheckConfiguration: Match.objectLike({ Protocol: "HTTP", Path: "/" }),
      SourceConfiguration: Match.objectLike({
        AutoDeploymentsEnabled: false,
        ImageRepository: Match.objectLike({ ImageRepositoryType: "ECR", ImageConfiguration: Match.objectLike({ Port: "3000" }) }),
      }),
    });
    web.hasResourceProperties("AWS::AppRunner::AutoScalingConfiguration", { MinSize: 1, MaxSize: 2 });
  });

  it("is told where sign-in and the database live, and has no secret in its settings", () => {
    const [service] = Object.values(webBefore.findResources("AWS::AppRunner::Service"));
    const image = service?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"];
    const variables = image["RuntimeEnvironmentVariables"] as { Name: string; Value: unknown }[];

    expect(variables.map((variable) => variable.Name).toSorted()).toEqual([
      "KIN_AUTH_CLIENT_ID",
      "KIN_AUTH_ISSUER",
      "KIN_AUTH_LOGIN_URL",
      "KIN_DATABASE_HOST",
      "KIN_DATABASE_NAME",
      "KIN_DATABASE_PORT",
      "KIN_DATABASE_TLS",
      "KIN_DEMO_CIRCLES",
    ]);
    expect(variables).toContainEqual({ Name: "KIN_DATABASE_TLS", Value: "require" });
    expect(variables).toContainEqual({ Name: "KIN_DEMO_CIRCLES", Value: "on" });
  });

  it("gets only the person's and the provisioner's database passwords and the demo key, from Secrets Manager", () => {
    const [service] = Object.values(webBefore.findResources("AWS::AppRunner::Service"));
    const secrets = service?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentSecrets"] as { Name: string; Value: unknown }[];

    expect(secrets.map((secret) => secret.Name).toSorted()).toEqual(["KIN_DATABASE_APP_PASSWORD", "KIN_DATABASE_PROVISIONER_PASSWORD", "KIN_DEMO_SESSION_KEY"]);
    for (const name of ["kin-database-app-secret-arn", "kin-database-provisioner-secret-arn", "kin-web-demo-session-key-arn"]) {
      data.hasResourceProperties("AWS::SSM::Parameter", { Name: name, Type: "String" });
    }
    for (const template of [webBefore, web]) expect(JSON.stringify(template.toJSON())).not.toMatch(/ADMIN|SERVICE_PASSWORD|kin-database-service/);
  });

  it("reaches the database through Kin's services subnets, in the group the database admits", () => {
    web.hasResourceProperties("AWS::AppRunner::VpcConnector", {
      VpcConnectorName: "kin-web",
      Subnets: { Ref: Match.stringLikeRegexp("SsmParameterValuekinservicessubnets") },
      SecurityGroups: [{ Ref: Match.stringLikeRegexp("SsmParameterValuekinservicessecuritygroup") }],
    });
    web.hasResourceProperties("AWS::AppRunner::Service", {
      NetworkConfiguration: {
        EgressConfiguration: { EgressType: "VPC", VpcConnectorArn: Match.anyValue() },
        IngressConfiguration: { IsPubliclyAccessible: true },
      },
    });
    data.hasResourceProperties("AWS::SSM::Parameter", { Name: "kin-services-subnets", Type: "StringList" });
  });

  it("learns its own address from the first https origin Cognito may return to", () => {
    const withOrigin = Template.fromStack(
      buildKin(new App({ context: testContext }), { ...config, webOrigins: ["http://localhost:3000", "https://kin.example.awsapprunner.com"] }).web,
    );
    const [service] = Object.values(withOrigin.findResources("AWS::AppRunner::Service"));
    const variables = service?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentVariables"];

    expect(variables).toContainEqual({ Name: "KIN_WEB_ORIGIN", Value: "https://kin.example.awsapprunner.com" });
  });

  it("reads its sign-in settings from KinData's parameters, never from a cross-stack output", () => {
    for (const name of ["kin-web-auth-issuer", "kin-web-auth-login-url", "kin-web-auth-client-id"]) {
      data.hasResourceProperties("AWS::SSM::Parameter", { Name: name, Type: "String" });
    }
    expect(JSON.stringify(web.toJSON())).not.toMatch(/Fn::ImportValue|Fn::GetStackOutput/);
    expect(Object.keys(web.toJSON()["Parameters"] as object).some((key) => key.startsWith("SsmParameterValuekinwebauth"))).toBe(true);
  });

  it("lets App Runner only pull the image, and the app only read its own three secrets", () => {
    const statements = Object.values(webBefore.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"]["PolicyDocument"]["Statement"] as { Action: string | string[]; Resource: unknown; Condition?: unknown }[],
    );
    const actions = statements.flatMap((statement) => [statement.Action].flat());

    expect(actions.filter((action) => !action.startsWith("ecr:")).toSorted()).toEqual(["kms:Decrypt", "secretsmanager:GetSecretValue"]);
    expect(actions).not.toContain("ecr:PutImage");
    const read = statements.find((statement) => statement.Action === "secretsmanager:GetSecretValue");
    expect(read?.Resource).toHaveLength(3);
    const decrypt = statements.find((statement) => statement.Action === "kms:Decrypt");
    expect(JSON.stringify(decrypt?.Condition)).toContain("kms:ViaService");
    web.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "kin-web-instance",
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: [Match.objectLike({ Principal: { Service: "tasks.apprunner.amazonaws.com" } })],
      }),
    });
  });
});

describe("deployment from GitHub", () => {
  it("trusts one repository and one branch, by exact match", () => {
    ci.hasResourceProperties("AWS::IAM::Role", {
      RoleName: "kin-github-deploy",
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: {
                "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
                "token.actions.githubusercontent.com:sub": config.githubDeploySubject,
              },
            },
          }),
        ],
      },
    });
  });

  it("may only hand over to Kin's own deployment roles, not the lookup role", () => {
    ci.hasResourceProperties("AWS::IAM::Policy", {
      PolicyDocument: {
        Statement: Match.arrayWith([
          {
            Action: "sts:AssumeRole",
            Effect: "Allow",
            Resource: [
              "arn:aws:iam::123456789012:role/cdk-kin-deploy-role-*",
              "arn:aws:iam::123456789012:role/cdk-kin-file-publishing-role-*",
              "arn:aws:iam::123456789012:role/cdk-kin-image-publishing-role-*",
            ],
            Sid: "UseKinBootstrapRolesOnly",
          },
        ]),
      },
    });
  });

  it("may otherwise only run the migration task, watch it and read its log", () => {
    const statements = Object.values(ci.findResources("AWS::IAM::Policy")).flatMap(
      (policy) => policy["Properties"]["PolicyDocument"]["Statement"] as { Sid: string; Action: string; Resource: unknown; Condition?: unknown }[],
    );
    expect(statements.map((statement) => [statement.Sid, statement.Action])).toEqual([
      ["UseKinBootstrapRolesOnly", "sts:AssumeRole"],
      ["RunTheMigrationTaskOnly", "ecs:RunTask"],
      ["WatchTheMigrationTask", "ecs:DescribeTasks"],
      ["HandTheMigrationTaskItsRoles", "iam:PassRole"],
      ["ReadWhereTheMigrationRuns", "ssm:GetParameter"],
      ["ReadTheMigrationLog", "logs:GetLogEvents"],
    ]);
    const bySid = (sid: string) => statements.find((statement) => statement.Sid === sid);
    expect(bySid("RunTheMigrationTaskOnly")).toMatchObject({
      Resource: "arn:aws:ecs:us-east-1:123456789012:task-definition/kin-database-migrate:*",
      Condition: { ArnEquals: { "ecs:cluster": "arn:aws:ecs:us-east-1:123456789012:cluster/kin" } },
    });
    expect(bySid("HandTheMigrationTaskItsRoles")).toMatchObject({
      Resource: ["arn:aws:iam::123456789012:role/kin-database-migrate-execution", "arn:aws:iam::123456789012:role/kin-database-migrate-task"],
      Condition: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
    });
    expect(JSON.stringify(statements)).not.toMatch(/"Resource":"\*"|"Action":"\*"/);
  });
});

describe("the deployment boundary", () => {
  const guardrails = Template.fromStack(stacks.guardrails);
  const boundaryArn = "arn:aws:iam::123456789012:policy/kin-deploy-boundary";
  const statements = (): { Sid: string; Effect: string; [key: string]: unknown }[] =>
    Object.values(guardrails.findResources("AWS::IAM::ManagedPolicy"))[0]?.["Properties"]["PolicyDocument"]["Statement"] ?? [];
  const statement = (sid: string) => statements().find((each) => each.Sid === sid);

  it("is deployed with the operator's own credentials, never through the bootstrap roles", () => {
    expect(stacks.guardrails.synthesizer).toBeInstanceOf(CliCredentialsStackSynthesizer);
    guardrails.hasResourceProperties("AWS::IAM::ManagedPolicy", {
      ManagedPolicyName: "kin-deploy-boundary",
    });
  });

  it("is carried by every role in the stacks CI deploys", () => {
    let roles = 0;
    for (const template of [data, network, ci, ops]) {
      for (const role of Object.values(template.findResources("AWS::IAM::Role"))) {
        roles += 1;
        // CDK writes the ARN as a string or as a join on the partition.
        expect(JSON.stringify(role["Properties"]["PermissionsBoundary"])).toMatch(
          /arn:(aws)?.*:iam::123456789012:policy\/kin-deploy-boundary"/,
        );
      }
    }
    expect(roles).toBeGreaterThanOrEqual(2);
  });

  it("allows only what no deny takes away", () => {
    expect(statement("AllowWithinTheDenies")).toMatchObject({ Effect: "Allow", Action: "*", Resource: "*" });
    expect(statements().filter((each) => each.Effect === "Allow")).toHaveLength(1);
  });

  it("denies everything tagged as another project, under either spelling of the tag", () => {
    for (const [sid, key] of [
      ["DenyResourcesTaggedAsAnotherProject", "project"],
      ["DenyResourcesTaggedAsAnotherProjectCapitalised", "Project"],
    ] as const) {
      expect(statement(sid)).toMatchObject({
        Effect: "Deny",
        Action: "*",
        Resource: "*",
        Condition: { StringEquals: { [`aws:ResourceTag/${key}`]: ["wick", "carecircle"] } },
      });
    }
  });

  it("denies the other projects' buckets and the default bootstrap's", () => {
    // CDK sorts the list.
    expect(statement("DenyOtherProjectsBuckets")?.["Resource"]).toEqual(
      [
        "arn:aws:s3:::carecircle*",
        "arn:aws:s3:::carecircle*/*",
        "arn:aws:s3:::cdk-hnb659fds*",
        "arn:aws:s3:::cdk-hnb659fds*/*",
        "arn:aws:s3:::wick*",
        "arn:aws:s3:::wick*/*",
      ],
    );
  });

  it("denies IAM changes to any principal that is not Kin's", () => {
    const iamDeny = statement("DenyIamOutsideKin");
    expect(iamDeny?.["Action"]).toEqual(
      expect.arrayContaining(["iam:Create*", "iam:Put*", "iam:Attach*", "iam:PassRole"]),
    );
    expect(iamDeny?.["NotResource"]).toEqual([
      "arn:aws:iam::123456789012:role/Kin*",
      "arn:aws:iam::123456789012:role/kin-*",
      "arn:aws:iam::123456789012:policy/kin-*",
      "arn:aws:iam::123456789012:instance-profile/Kin*",
      "arn:aws:iam::123456789012:role/aws-service-role/*",
    ]);
  });

  it("denies making or arming a role that does not carry the boundary", () => {
    expect(statement("DenyRolesWithoutThisBoundary")).toMatchObject({
      Effect: "Deny",
      Action: expect.arrayContaining(["iam:CreateRole", "iam:AttachRolePolicy", "iam:PutRolePolicy", "iam:PutRolePermissionsBoundary"]),
      Condition: { StringNotEquals: { "iam:PermissionsBoundary": boundaryArn } },
    });
    expect(statement("DenyRemovingAnyBoundary")?.["Action"]).toEqual([
      "iam:DeleteRolePermissionsBoundary",
      "iam:DeleteUserPermissionsBoundary",
    ]);
  });

  it("lets a bounded role assume only Kin's roles and the bootstrap's deployment roles", () => {
    expect(statement("DenyAssumingRolesOutsideKin")).toMatchObject({
      Effect: "Deny",
      Action: ["sts:AssumeRole", "sts:SetSourceIdentity", "sts:TagSession"],
      NotResource: [
        "arn:aws:iam::123456789012:role/Kin*",
        "arn:aws:iam::123456789012:role/kin-*",
        "arn:aws:iam::123456789012:role/cdk-kin-deploy-role-*",
        "arn:aws:iam::123456789012:role/cdk-kin-file-publishing-role-*",
        "arn:aws:iam::123456789012:role/cdk-kin-image-publishing-role-*",
      ],
    });
  });

  it("cannot be rewritten by a deployment it limits", () => {
    expect(statement("DenyChangingThisBoundary")).toMatchObject({
      Effect: "Deny",
      Action: expect.arrayContaining(["iam:CreatePolicyVersion", "iam:SetDefaultPolicyVersion", "iam:DeletePolicy"]),
      Resource: boundaryArn,
    });
  });

  it("leaves room for every role Kin's stacks create", () => {
    for (const stack of Object.values(stacks)) {
      expect(stack?.stackName).toMatch(/^Kin/);
    }
    for (const template of all) {
      for (const role of Object.values(template.findResources("AWS::IAM::Role"))) {
        const name = role["Properties"]["RoleName"];
        if (typeof name === "string") {
          expect(name).toMatch(/^(Kin|kin-)/);
        }
      }
    }
  });
});

describe("cost", () => {
  it("budgets only the resources tagged project=kin", () => {
    ops.hasResourceProperties("AWS::Budgets::Budget", {
      Budget: Match.objectLike({
        BudgetLimit: { Amount: 150, Unit: "USD" },
        FilterExpression: { Tags: { Key: "project", Values: ["kin"] } },
      }),
    });
  });

  it("runs one NAT gateway, not one per zone", () => {
    network.resourceCountIs("AWS::EC2::NatGateway", 1);
  });
});

describe("top-ups", () => {
  const statementsOf = (template: Template) => Object.values(template.findResources("AWS::IAM::Policy")).flatMap((policy) => policy["Properties"]["PolicyDocument"]["Statement"] as { Action: string | string[] }[]);
  const actionsOf = (template: Template) => statementsOf(template).flatMap((statement) => [statement.Action].flat());

  it("let the web app send to the PayPal inbox and nothing more, with the client ID beside the client secret", () => {
    expect(actionsOf(web).filter((action) => !action.startsWith("ecr:")).toSorted()).toEqual([
      "kms:Decrypt",
      "kms:Decrypt",
      "kms:GenerateDataKey",
      "secretsmanager:GetSecretValue",
      "sqs:SendMessage",
    ]);
    // Its three secrets and PayPal's, in one statement.
    const read = statementsOf(web).find((statement) => statement.Action === "secretsmanager:GetSecretValue") as { Resource?: unknown[] } | undefined;
    expect(read?.Resource).toHaveLength(4);
    const [service] = Object.values(web.findResources("AWS::AppRunner::Service"));
    const image = service?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"];
    const added = (list: { Name: string }[], before: { Name: string }[]) => list.map((each) => each.Name).filter((name) => !before.some((old) => old.Name === name)).toSorted();
    const [old] = Object.values(webBefore.findResources("AWS::AppRunner::Service"));
    const oldImage = old?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"];
    expect(added(image["RuntimeEnvironmentVariables"], oldImage["RuntimeEnvironmentVariables"])).toEqual(["AWS_REGION", "KIN_PAYPAL_CLIENT_ID", "KIN_PAYPAL_INBOX_URL"]);
    expect(image["RuntimeEnvironmentVariables"]).toContainEqual({ Name: "KIN_PAYPAL_CLIENT_ID", Value: "sandbox-client-id" });
    expect(added(image["RuntimeEnvironmentSecrets"], oldImage["RuntimeEnvironmentSecrets"])).toEqual(["KIN_PAYPAL_CLIENT_SECRET"]);
    const sqsKey = statementsOf(web).find((statement) => [statement.Action].flat().includes("kms:GenerateDataKey")) as { Condition?: unknown } | undefined;
    expect(JSON.stringify(sqsKey?.Condition)).toContain("sqs.");
  });

  it("run the worker as one small Graviton task with no way in, taking messages off the inbox only", () => {
    worker.hasResourceProperties("AWS::ECS::TaskDefinition", { Cpu: "256", Memory: "512", RuntimePlatform: { CpuArchitecture: "ARM64", OperatingSystemFamily: "LINUX" } });
    worker.hasResourceProperties("AWS::ECS::Service", {
      DesiredCount: 1,
      DeploymentConfiguration: Match.objectLike({ MinimumHealthyPercent: 0, MaximumPercent: 100 }),
      NetworkConfiguration: { AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" }) },
    });
    worker.resourceCountIs("AWS::ElasticLoadBalancingV2::LoadBalancer", 0);
    worker.resourceCountIs("AWS::Lambda::Function", 0);
    expect(actionsOf(worker).filter((action) => action.startsWith("sqs:")).toSorted()).toEqual(["sqs:ChangeMessageVisibility", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ReceiveMessage"]);
  });

  it("give the service role's password to the worker alone", () => {
    const container = JSON.stringify(worker.findResources("AWS::ECS::TaskDefinition"));
    expect(container).toContain("KIN_DATABASE_SERVICE_PASSWORD");
    expect(container).toContain("KIN_PAYPAL_CLIENT_SECRET");
    expect(container).toContain("WH-SANDBOX");
    expect(container).not.toMatch(/KIN_DATABASE_(ADMIN|APP|PROVISIONER)_PASSWORD/);
  });

  it("wait out a paused Aurora before the inbox hands a message out again", () => {
    data.hasResourceProperties("AWS::SQS::Queue", { QueueName: "kin-paypal-events.fifo", VisibilityTimeout: 300 });
  });

  it("let the web app listen and speak only when speech is switched on", () => {
    expect(actionsOf(webBefore).some((action) => action.startsWith("transcribe:") || action.startsWith("polly:"))).toBe(false);
    expect(JSON.stringify(webBefore.toJSON())).not.toContain("KIN_SPEECH_REGION");
    const on = Template.fromStack(buildKin(new App({ context: testContext }), { ...config, speech: true }).web);
    expect(actionsOf(on)).toEqual(expect.arrayContaining(["transcribe:StartStreamTranscription", "polly:SynthesizeSpeech"]));
    expect(JSON.stringify(on.toJSON())).toContain("KIN_SPEECH_REGION");
  });

  it("let the web app ask Claude only when Claude is switched on, and only through Bedrock in its own account", () => {
    expect(actionsOf(webBefore).some((action) => action.startsWith("bedrock") || action.startsWith("aws-marketplace:"))).toBe(false);
    expect(JSON.stringify(webBefore.toJSON())).not.toContain("KIN_BEDROCK_REGION");
    const on = Template.fromStack(buildKin(new App({ context: testContext }), { ...config, claude: true }).web);
    expect(actionsOf(on)).toEqual(expect.arrayContaining(["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream", "aws-marketplace:Subscribe"]));
    expect(actionsOf(on).some((action) => action.startsWith("bedrock-mantle:") || action === "bedrock:*")).toBe(false);
    const policies = JSON.stringify(on.findResources("AWS::IAM::Policy"));
    expect(policies).toContain("arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-4-6-v1");
    expect(policies).toContain("arn:aws:bedrock:*::foundation-model/anthropic.claude-opus-4-6-v1");
    expect(policies).toContain("bedrock:InferenceProfileArn");
    expect(policies).toContain("bedrock.amazonaws.com");
    const template = JSON.stringify(on.toJSON());
    expect(template).toContain("KIN_BEDROCK_REGION");
    expect(template).toContain('"Name":"KIN_BEDROCK_API","Value":"invoke"');
    expect(template).toContain('"Name":"KIN_BEDROCK_MODEL","Value":"us.anthropic.claude-opus-4-6-v1"');
  });

  it("stay off, in the web app and the worker alike, until PayPal is configured", () => {
    const off = buildKin(new App({ context: testContext }), { ...config, paypal: null });
    expect(off.worker).toBeNull();
    expect(actionsOf(Template.fromStack(off.web)).some((action) => action.startsWith("sqs:"))).toBe(false);
    expect(JSON.stringify(Template.fromStack(off.web).toJSON())).not.toContain("KIN_PAYPAL");
  });
});

describe("real sandbox payouts in demo circles", () => {
  const payee = "sb-kin-payee@personal.example.com";
  const withPayee = buildKin(new App({ context: testContext }), { ...config, demoSandboxPayeeEmail: payee });
  const variablesOf = (template: Template) => {
    const [service] = Object.values(template.findResources("AWS::AppRunner::Service"));
    return service?.["Properties"]["SourceConfiguration"]["ImageRepository"]["ImageConfiguration"]["RuntimeEnvironmentVariables"] as { Name: string; Value: unknown }[];
  };
  const workerVariables = (template: Template) => JSON.stringify(Object.values(template.findResources("AWS::ECS::TaskDefinition")).map((task) => task["Properties"]["ContainerDefinitions"]));

  it("are off unless Kin's sandbox account is named: neither the worker nor the web hears of one", () => {
    expect(workerVariables(worker)).not.toContain("KIN_DEMO_SANDBOX_PAYEE_EMAIL");
    expect(variablesOf(web).map((each) => each.Name)).not.toContain("KIN_DEMO_SANDBOX_PAYEE_EMAIL");
  });

  it("named, reach the worker that pays them and the web that says so, as a plain setting", () => {
    if (withPayee.worker === null) throw new Error("KinWorker exists with a PayPal app");
    expect(workerVariables(Template.fromStack(withPayee.worker))).toContain(`{"Name":"KIN_DEMO_SANDBOX_PAYEE_EMAIL","Value":"${payee}"}`);
    expect(variablesOf(Template.fromStack(withPayee.web))).toContainEqual({ Name: "KIN_DEMO_SANDBOX_PAYEE_EMAIL", Value: payee });
  });
});
