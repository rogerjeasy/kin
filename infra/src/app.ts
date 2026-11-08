import { App, Tags } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";

import { CiStack } from "./ci-stack.ts";
import type { InfraConfig } from "./config.ts";
import { DataStack } from "./data-stack.ts";
import { DEPLOY_BOUNDARY_POLICY, GuardrailsStack } from "./guardrails-stack.ts";
import { NetworkStack } from "./network-stack.ts";
import { OpsStack } from "./ops-stack.ts";
import { TAGS } from "./tags.ts";
import { WebStack } from "./web-stack.ts";
import { WorkerStack } from "./worker-stack.ts";

export type KinStacks = {
  readonly guardrails: GuardrailsStack;
  readonly ops: OpsStack;
  readonly network: NetworkStack;
  readonly data: DataStack;
  readonly ci: CiStack;
  readonly web: WebStack;
  /** Deployed with top-ups, when `kin:paypal` in cdk.json names the PayPal app and its webhook. */
  readonly worker: WorkerStack | null;
};

/**
 * Kin's stacks, each named Kin*, in the shared account. The web app runs on
 * App Runner (KinWeb); the worker on Fargate (KinWorker), once top-ups are
 * configured. Voice compute joins when it has an image.
 * KinGuardrails is deployed by a person; CI deploys the others.
 */
export function buildKin(app: App, config: InfraConfig): KinStacks {
  const env = { account: config.account, region: config.region };
  for (const [key, value] of Object.entries(TAGS)) {
    Tags.of(app).add(key, value);
  }

  const guardrails = new GuardrailsStack(app, "KinGuardrails", config, { env });
  const ops = new OpsStack(app, "KinOps", config, { env });
  const network = new NetworkStack(app, "KinNetwork", config, { env });
  const data = new DataStack(app, "KinData", config, {
    env,
    vpc: network.vpc,
    servicesSecurityGroup: network.servicesSecurityGroup,
    alerts: ops.alerts,
  });
  const ci = new CiStack(app, "KinCi", config, { env });
  const web = new WebStack(app, "KinWeb", config, { env });
  // The web app reads the sign-in settings KinData publishes.
  web.addDependency(data);
  const worker =
    config.paypal === null
      ? null
      : new WorkerStack(app, "KinWorker", { env, vpc: network.vpc, servicesSecurityGroup: network.servicesSecurityGroup, paypal: config.paypal, demoSandboxPayeeEmail: config.demoSandboxPayeeEmail });
  // It reads the database, queue and secret settings KinData publishes.
  worker?.addDependency(data);

  // Every role these stacks create carries the boundary, so no role made
  // during a deployment can do more than the deployment itself.
  for (const stack of [ops, network, data, ci, web, ...(worker === null ? [] : [worker])]) {
    iam.PermissionsBoundary.of(stack).apply(
      iam.ManagedPolicy.fromManagedPolicyName(stack, "DeployBoundary", DEPLOY_BOUNDARY_POLICY),
    );
  }
  return { guardrails, ops, network, data, ci, web, worker };
}
