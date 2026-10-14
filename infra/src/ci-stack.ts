import { Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";

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
  }
}
