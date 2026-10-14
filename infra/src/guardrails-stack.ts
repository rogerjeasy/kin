import { CliCredentialsStackSynthesizer, Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";

/**
 * The permissions boundary on Kin's CloudFormation execution role and on
 * every role Kin's stacks create. A boundary is a ceiling: whatever policies a
 * role holds, AdministratorAccess included, it can do no more than this.
 */
export const DEPLOY_BOUNDARY_POLICY = "kin-deploy-boundary";

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

/** Changes to a role's or user's powers, allowed only under the boundary. */
const BOUNDED_IAM_CHANGES = [
  "iam:CreateRole",
  "iam:CreateUser",
  "iam:PutRolePermissionsBoundary",
  "iam:PutUserPermissionsBoundary",
  "iam:AttachRolePolicy",
  "iam:DetachRolePolicy",
  "iam:PutRolePolicy",
  "iam:DeleteRolePolicy",
];

/**
 * Holds the boundary. It is deployed with the operator's own credentials, not
 * through Kin's bootstrap roles, so no deployment can loosen the limits it
 * runs under, and CI never deploys it (docs/architecture.md section 14.8).
 */
export class GuardrailsStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, { ...props, synthesizer: new CliCredentialsStackSynthesizer() });

    const { account } = config;
    const boundaryArn = `arn:aws:iam::${account}:policy/${DEPLOY_BOUNDARY_POLICY}`;
    const projects = config.neighbourProjects;
    const bucketPrefixes = [...projects, "cdk-hnb659fds"];

    new iam.ManagedPolicy(this, "DeployBoundary", {
      managedPolicyName: DEPLOY_BOUNDARY_POLICY,
      description: "The most a Kin deployment, or a role it creates, may ever do",
      statements: [
        new iam.PolicyStatement({
          sid: "AllowWithinTheDenies",
          actions: ["*"],
          resources: ["*"],
        }),
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
          // A role made or changed without this boundary would escape it.
          sid: "DenyRolesWithoutThisBoundary",
          effect: iam.Effect.DENY,
          actions: BOUNDED_IAM_CHANGES,
          resources: ["*"],
          conditions: { StringNotEquals: { "iam:PermissionsBoundary": boundaryArn } },
        }),
        new iam.PolicyStatement({
          sid: "DenyRemovingAnyBoundary",
          effect: iam.Effect.DENY,
          actions: [
            "iam:DeleteRolePermissionsBoundary",
            "iam:DeleteUserPermissionsBoundary",
          ],
          resources: ["*"],
        }),
        new iam.PolicyStatement({
          sid: "DenyChangingThisBoundary",
          effect: iam.Effect.DENY,
          actions: [
            "iam:CreatePolicyVersion",
            "iam:DeletePolicy",
            "iam:DeletePolicyVersion",
            "iam:SetDefaultPolicyVersion",
            "iam:TagPolicy",
            "iam:UntagPolicy",
          ],
          resources: [boundaryArn],
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
}
