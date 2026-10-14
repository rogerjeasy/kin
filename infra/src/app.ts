import { App, Tags } from "aws-cdk-lib";

import { CiStack } from "./ci-stack.ts";
import type { InfraConfig } from "./config.ts";
import { DataStack } from "./data-stack.ts";
import { NetworkStack } from "./network-stack.ts";
import { OpsStack } from "./ops-stack.ts";
import { TAGS } from "./tags.ts";

export type KinStacks = {
  readonly ops: OpsStack;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly ci: CiStack;
};

/**
 * Kin's stacks, each named Kin*, in the shared account. Compute (the load
 * balancer and the Fargate services) joins when the apps have images.
 */
export function buildKin(app: App, config: InfraConfig): KinStacks {
  const env = { account: config.account, region: config.region };
  for (const [key, value] of Object.entries(TAGS)) {
    Tags.of(app).add(key, value);
  }

  const ops = new OpsStack(app, "KinOps", config, { env });
  const network = new NetworkStack(app, "KinNetwork", config, { env });
  const data = new DataStack(app, "KinData", config, {
    env,
    vpc: network.vpc,
    servicesSecurityGroup: network.servicesSecurityGroup,
    alerts: ops.alerts,
  });
  const ci = new CiStack(app, "KinCi", config, { env });
  return { ops, network, data, ci };
}
