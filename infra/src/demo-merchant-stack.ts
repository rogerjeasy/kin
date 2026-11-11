import { CfnOutput, IgnoreMode, Stack, type StackProps } from "aws-cdk-lib";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import { DATABASE_SETTINGS, DEMO_MERCHANT_SETTINGS } from "./database-settings.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The port `apps/demo-merchant` listens on (its `PORT` default). */
export const DEMO_MERCHANT_PORT = 4100;

/**
 * The demo pharmacy on App Runner (docs/architecture.md section 8.6 and
 * decision 105): a stand-in seller with its own PayPal sandbox app, which
 * charges Rose's saved payment method when Kin's worker sends it a signed
 * order and reads the payment back from PayPal when asked. It holds no
 * database password and no Kin PayPal secret: only its own app's
 * credentials, the vault ID and the secret it checks the worker's signature
 * with. It needs no network of Kin's: it talks to PayPal over the internet,
 * and the worker reaches it at its https address.
 *
 * Exactly one instance: its order book (the order's delivery schedule and the
 * charge a repeated key returns) is held in memory. PayPal's request ID still
 * makes a repeat the same charge if it restarts.
 */
export class DemoMerchantStack extends Stack {
  /** The pharmacy's https address, for the worker's `KIN_DEMO_MERCHANT_URL`. */
  readonly url: string;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    const image = new ecrAssets.DockerImageAsset(this, "Image", {
      directory: repositoryRoot,
      file: "apps/demo-merchant/Dockerfile",
      platform: ecrAssets.Platform.LINUX_AMD64,
      ignoreMode: IgnoreMode.DOCKER,
    });
    const imageAccess = new iam.Role(this, "ImageAccess", {
      description: "Lets App Runner pull Kin's demo pharmacy image",
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
    });
    image.repository.grantPull(imageAccess);

    const scaling = new apprunner.CfnAutoScalingConfiguration(this, "Scaling", {
      autoScalingConfigurationName: "kin-demo-merchant",
      minSize: 1,
      maxSize: 1,
      maxConcurrency: 50,
    });

    const setting = (name: string) => ssm.StringParameter.valueForStringParameter(this, name);
    const clientId = setting(DEMO_MERCHANT_SETTINGS.clientIdSecretArn);
    const clientSecret = setting(DEMO_MERCHANT_SETTINGS.clientSecretSecretArn);
    const vaultId = setting(DEMO_MERCHANT_SETTINGS.vaultIdSecretArn);
    const signingSecret = setting(DEMO_MERCHANT_SETTINGS.signingSecretArn);

    // Its four secrets and nothing else. App Runner reads them when it starts the service and never logs them.
    const instance = new iam.Role(this, "Instance", {
      roleName: "kin-demo-merchant-instance",
      description: "What Kin's demo pharmacy may reach in AWS: its own PayPal sandbox app, Rose's vault ID and the worker's signing secret",
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });
    instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [clientId, clientSecret, vaultId, signingSecret] }));
    instance.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [setting(DATABASE_SETTINGS.keyArn)],
        conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
      }),
    );

    const service = new apprunner.CfnService(this, "Service", {
      serviceName: "kin-demo-merchant",
      sourceConfiguration: {
        autoDeploymentsEnabled: false,
        authenticationConfiguration: { accessRoleArn: imageAccess.roleArn },
        imageRepository: {
          imageIdentifier: image.imageUri,
          imageRepositoryType: "ECR",
          imageConfiguration: {
            port: String(DEMO_MERCHANT_PORT),
            runtimeEnvironmentVariables: [{ name: "PORT", value: String(DEMO_MERCHANT_PORT) }],
            runtimeEnvironmentSecrets: [
              { name: "KIN_MERCHANT_PAYPAL_CLIENT_ID", value: clientId },
              { name: "KIN_MERCHANT_PAYPAL_CLIENT_SECRET", value: clientSecret },
              { name: "KIN_MERCHANT_PAYPAL_VAULT_ID", value: vaultId },
              { name: "KIN_DEMO_MERCHANT_SIGNING_SECRET", value: signingSecret },
            ],
          },
        },
      },
      instanceConfiguration: { cpu: "0.25 vCPU", memory: "0.5 GB", instanceRoleArn: instance.roleArn },
      networkConfiguration: { egressConfiguration: { egressType: "DEFAULT" }, ingressConfiguration: { isPubliclyAccessible: true } },
      healthCheckConfiguration: { protocol: "HTTP", path: "/health", interval: 10, timeout: 5, healthyThreshold: 1, unhealthyThreshold: 5 },
      autoScalingConfigurationArn: scaling.attrAutoScalingConfigurationArn,
    });
    service.node.addDependency(imageAccess);
    service.node.addDependency(instance);

    this.url = `https://${service.attrServiceUrl}`;
    new CfnOutput(this, "Url", { value: this.url, description: "Where Kin's demo pharmacy is served: the worker's KIN_DEMO_MERCHANT_URL" });
  }
}
