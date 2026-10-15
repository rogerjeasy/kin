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
};

// The same feature flags as a real synth, so the tests see what is deployed.
const cdkJson = JSON.parse(
  readFileSync(new URL("../cdk.json", import.meta.url), "utf8"),
) as { context: Record<string, unknown> };
const stacks = buildKin(new App({ context: cdkJson.context }), config);
const data = Template.fromStack(stacks.data);
const network = Template.fromStack(stacks.network);
const ci = Template.fromStack(stacks.ci);
const ops = Template.fromStack(stacks.ops);
const all = [data, network, ci, ops];

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

    // Two buckets, ten queues, two secrets (the database's and the Gmail app password) and the key.
    expect(statements).toHaveLength(2 + 10 + 2 + 1);
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
        new App({ context: { ...cdkJson.context, "aws:cdk:bundling-stacks": [] } }),
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
        Statement: [
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
        ],
      },
    });
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
      expect(stack.stackName).toMatch(/^Kin/);
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
