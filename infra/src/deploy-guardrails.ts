import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";

/** Attached to Kin's CDK execution role beside AdministratorAccess. */
export const DEPLOY_GUARDRAILS_POLICY = "kin-deploy-guardrails";

/** The IAM resources a Kin deployment may create or change. */
const KIN_IAM_RESOURCES = [
  "role/Kin*",
  "role/kin-*",
  "policy/kin-*",
  "instance-profile/Kin*",
  // Service-linked roles that AWS services create on first use, such as RDS's.
  "role/aws-service-role/*",
];

/** Every IAM verb that creates, changes, deletes or hands on a principal. */
const IAM_WRITES = [
  "iam:Add*",
  "iam:Attach*",
  "iam:Change*",
  "iam:Create*",
  "iam:Deactivate*",
  "iam:Delete*",
  "iam:Detach*",
  "iam:Enable*",
  "iam:PassRole",
  "iam:Put*",
  "iam:Remove*",
  "iam:Reset*",
  "iam:Resync*",
  "iam:Set*",
  "iam:Tag*",
  "iam:Untag*",
  "iam:Update*",
  "iam:Upload*",
];

/**
 * The stock CDK bootstrap lets CloudFormation do anything in the account
 * while it deploys Kin, and the account is shared. These denies leave Kin's
 * own deployments working and take away the rest: the other projects'
 * resources, any IAM principal that is not Kin's (so a deployment cannot mint
 * itself a way out), and the account itself.
 */
export function createDeployGuardrails(
  scope: Construct,
  config: InfraConfig,
): iam.ManagedPolicy {
  const { account } = config;
  const projects = config.neighbourProjects;
  const bucketPrefixes = [...projects, "cdk-hnb659fds"];

  return new iam.ManagedPolicy(scope, "DeployGuardrails", {
    managedPolicyName: DEPLOY_GUARDRAILS_POLICY,
    description: "Limits what CloudFormation may do while deploying Kin",
    statements: [
      // Two statements, because two keys in one condition must both match.
      ...["project", "Project"].map(
        (key) =>
          new iam.PolicyStatement({
            sid: `DenyResourcesTaggedAsAnotherProject${key === "Project" ? "Capitalised" : ""}`,
            effect: iam.Effect.DENY,
            actions: ["*"],
            resources: ["*"],
            conditions: { StringEquals: { [`aws:ResourceTag/${key}`]: projects } },
          }),
      ),
      new iam.PolicyStatement({
        // Most S3 actions cannot be matched on tags, so buckets go by name.
        sid: "DenyOtherProjectsBuckets",
        effect: iam.Effect.DENY,
        actions: ["s3:*"],
        resources: bucketPrefixes.flatMap((prefix) => [
          `arn:aws:s3:::${prefix}*`,
          `arn:aws:s3:::${prefix}*/*`,
        ]),
      }),
      new iam.PolicyStatement({
        sid: "DenyIamOutsideKin",
        effect: iam.Effect.DENY,
        actions: IAM_WRITES,
        notResources: KIN_IAM_RESOURCES.map(
          (resource) => `arn:aws:iam::${account}:${resource}`,
        ),
      }),
      new iam.PolicyStatement({
        sid: "DenyAccountWideChanges",
        effect: iam.Effect.DENY,
        actions: ["account:*", "organizations:*", "billing:*"],
        resources: ["*"],
      }),
    ],
  });
}
