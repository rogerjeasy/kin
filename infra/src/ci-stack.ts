import { Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { DATABASE_SETTINGS, MIGRATION_TASK } from "./database-settings.ts";

const GITHUB_ISSUER = "token.actions.githubusercontent.com";

/** The bootstrap roles a CDK deployment assumes. */
const DEPLOY_BOOTSTRAP_ROLES = ["deploy", "file-publishing", "image-publishing"];

/**
 * The role GitHub Actions assumes to deploy Kin. The account's GitHub OIDC
 * provider already exists and is shared, because an account holds one per
 * issuer. The role may do one thing: hand the deployment to the CDK roles of
 * Kin's own bootstrap, never another project's.
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);

    const github = iam.OpenIdConnectProvider.fromOpenIdConnectProviderArn(
      this,
      "GitHub",
      `arn:aws:iam::${this.account}:oidc-provider/${GITHUB_ISSUER}`,
    );

    const role = new iam.Role(this, "Deploy", {
      roleName: "kin-github-deploy",
      description: "GitHub Actions deploys Kin from its main branch",
      // StringEquals, never StringLike: a wildcard lets another repository or
      // branch take the role.
      assumedBy: new iam.WebIdentityPrincipal(github.openIdConnectProviderArn, {
        StringEquals: {
          [`${GITHUB_ISSUER}:aud`]: "sts.amazonaws.com",
          [`${GITHUB_ISSUER}:sub`]: config.githubDeploySubject,
        },
      }),
    });
    // Not the lookup role: Kin's synth needs no lookups, and that role can
    // read the whole account.
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "UseKinBootstrapRolesOnly",
        actions: ["sts:AssumeRole"],
        resources: DEPLOY_BOOTSTRAP_ROLES.map(
          (name) => `arn:aws:iam::${this.account}:role/cdk-kin-${name}-role-*`,
        ),
      }),
    );
    // Between deploying KinData and KinWeb, the pipeline migrates the
    // database (infra/scripts/run-migrations.ts). It may run that one task
    // and read what it needs to, nothing else in ECS.
    const arn = (service: string, resource: string) => `arn:aws:${service}:${this.region}:${this.account}:${resource}`;
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "RunTheMigrationTaskOnly",
        actions: ["ecs:RunTask"],
        resources: [arn("ecs", `task-definition/${MIGRATION_TASK.family}:*`)],
        conditions: { ArnEquals: { "ecs:cluster": arn("ecs", `cluster/${MIGRATION_TASK.cluster}`) } },
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "WatchTheMigrationTask",
        actions: ["ecs:DescribeTasks"],
        resources: [arn("ecs", `task/${MIGRATION_TASK.cluster}/*`)],
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "HandTheMigrationTaskItsRoles",
        actions: ["iam:PassRole"],
        resources: [MIGRATION_TASK.executionRole, MIGRATION_TASK.taskRole].map((name) => `arn:aws:iam::${this.account}:role/${name}`),
        conditions: { StringEquals: { "iam:PassedToService": "ecs-tasks.amazonaws.com" } },
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadWhereTheMigrationRuns",
        actions: ["ssm:GetParameter"],
        resources: [DATABASE_SETTINGS.servicesSubnets, DATABASE_SETTINGS.servicesSecurityGroup].map((name) => arn("ssm", `parameter/${name}`)),
      }),
    );
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "ReadTheMigrationLog",
        actions: ["logs:GetLogEvents"],
        resources: [arn("logs", "log-group:/kin/database-migrate:log-stream:*")],
      }),
    );
  }
}
