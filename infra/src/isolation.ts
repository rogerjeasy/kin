import { Stack } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";

import type { InfraConfig } from "./config.ts";

/**
 * Kin shares its AWS account with other projects. Separate names keep their
 * resources apart, but some of their roles and users hold account-wide
 * permissions such as s3:* on every resource. An explicit deny in each Kin
 * store's own policy overrides any allow they have, so their code cannot read, change or
 * delete Kin's data even by mistake.
 */
export function denyNeighbours(
  scope: IConstruct,
  config: InfraConfig,
  actions: string[],
  resources: string[],
): iam.PolicyStatement {
  const { account } = Stack.of(scope);
  return new iam.PolicyStatement({
    sid: "DenyOtherProjectsInThisAccount",
    effect: iam.Effect.DENY,
    principals: [new iam.AnyPrincipal()],
    actions,
    resources,
    conditions: {
      ArnLike: {
        "aws:PrincipalArn": config.neighbourPrincipalPatterns.map(
          (pattern) => `arn:aws:iam::${account}:${pattern}`,
        ),
      },
    },
  });
}
