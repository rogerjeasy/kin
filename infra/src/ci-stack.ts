import { Stack, type StackProps } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { createDeployGuardrails } from "./deploy-guardrails.ts";

const GITHUB_ISSUER = "token.actions.githubusercontent.com";

/**
 * The role GitHub Actions assumes to deploy Kin. The account's GitHub OIDC
 * provider already exists and is shared, because an account holds one per
 * issuer. The role may do one thing: hand the deployment to the CDK roles of
 * Kin's own bootstrap, never another project's.
 *
 * This stack also holds the guardrails that Kin's bootstrap attaches to the
 * CloudFormation execution role, so it is deployed before the bootstrap names
 * them (docs/architecture.md section 14.8).
 */
export class CiStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);
    createDeployGuardrails(this, config);

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
    role.addToPolicy(
      new iam.PolicyStatement({
        sid: "UseKinBootstrapRolesOnly",
        actions: ["sts:AssumeRole"],
        resources: [`arn:aws:iam::${this.account}:role/cdk-kin-*`],
      }),
    );
  }
}
