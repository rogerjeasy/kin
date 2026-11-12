import { App, Tags } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";

import { CiStack } from "./ci-stack.ts";
import { invitationEmailSettings, presenceTextSettings, shiftCallSettings, type InfraConfig } from "./config.ts";
import { DataStack } from "./data-stack.ts";
import { DEPLOY_BOUNDARY_POLICY, GuardrailsStack } from "./guardrails-stack.ts";
import { NetworkStack } from "./network-stack.ts";
import { OpsStack } from "./ops-stack.ts";
import { TAGS } from "./tags.ts";
import { VoiceStack } from "./voice-stack.ts";
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
  /** Deployed when `kin:voice` in cdk.json is true: Kin's phone service on App Runner. */
  readonly voice: VoiceStack | null;
};

/**
 * Kin's stacks, each named Kin*, in the shared account. The web app runs on
 * App Runner (KinWeb); the worker on Fargate (KinWorker), once top-ups are
 * configured; the phone service (KinVoice) on App Runner, once `kin:voice` is on.
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
      : new WorkerStack(app, "KinWorker", {
          env,
          vpc: network.vpc,
          servicesSecurityGroup: network.servicesSecurityGroup,
          paypal: config.paypal,
          demoSandboxPayeeEmail: config.demoSandboxPayeeEmail,
          // Only with the phone service, a number and the service's address, so a half-set deployment places no call.
          shiftCall: shiftCallSettings(config),
          // Only with a sender and the web app's https address, so no family member is sent a link that leads nowhere.
          presenceTexts: presenceTextSettings(config),
          // Only with Kin's Gmail sender and the web app's https address, so no invitation is emailed with a link that leads nowhere.
          invitationEmails: invitationEmailSettings(config),
        });
  // It reads the database, queue and secret settings KinData publishes.
  worker?.addDependency(data);
  const voice = config.voice ? new VoiceStack(app, "KinVoice", config, { env }) : null;
  // It reads the database and Twilio settings KinData publishes.
  voice?.addDependency(data);
  // It uses the connector the web app made.
  voice?.addDependency(web);

  // Every role these stacks create carries the boundary, so no role made
  // during a deployment can do more than the deployment itself.
  for (const stack of [ops, network, data, ci, web, ...(worker === null ? [] : [worker]), ...(voice === null ? [] : [voice])]) {
    iam.PermissionsBoundary.of(stack).apply(
      iam.ManagedPolicy.fromManagedPolicyName(stack, "DeployBoundary", DEPLOY_BOUNDARY_POLICY),
    );
  }
  return { guardrails, ops, network, data, ci, web, worker, voice };
}
