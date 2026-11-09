import { CfnOutput, IgnoreMode, Stack, type StackProps } from "aws-cdk-lib";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import type { InfraConfig } from "./config.ts";
import { DATABASE_SETTINGS, SHARED_CONNECTOR, TWILIO_SETTINGS } from "./database-settings.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The port `apps/voice` listens on (its `PORT` default). */
export const VOICE_PORT = 4200;

/**
 * What the service is told its address is until `kin:voicePublicUrl` names the
 * real one. App Runner names the service only when it creates it, so the first
 * deployment cannot know it (the same two steps as `kin:webOrigins`). The
 * `.invalid` top-level domain never resolves, so nothing Twilio signed can
 * match it, and every request fails the signature check until the second
 * deployment sets the real address.
 */
export const VOICE_ADDRESS_PLACEHOLDER = "https://voice-address-not-set.invalid";

/**
 * Kin's phone service on App Runner (docs/architecture.md decision 85). Twilio
 * calls it over the internet, so it needs an https address that is stable and
 * has no domain, which App Runner gives, as it does the web app (decision 35).
 * It answers Twilio's webhooks and reads and writes the database as the service
 * identity, one circle at a time, so it holds that password, the Twilio auth
 * token that verifies every webhook and the key that opens a call's token.
 * It holds neither the Twilio account SID (only the worker dials) nor any other
 * password.
 */
export class VoiceStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);

    // Built from the repository during `cdk deploy`, for App Runner's x86 machines.
    const image = new ecrAssets.DockerImageAsset(this, "Image", {
      directory: repositoryRoot,
      file: "apps/voice/Dockerfile",
      platform: ecrAssets.Platform.LINUX_AMD64,
      ignoreMode: IgnoreMode.DOCKER,
    });

    const imageAccess = new iam.Role(this, "ImageAccess", {
      description: "Lets App Runner pull Kin's voice image",
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
    });
    image.repository.grantPull(imageAccess);

    // One instance always warm, at most two: a call must be answered the moment Twilio asks.
    const scaling = new apprunner.CfnAutoScalingConfiguration(this, "Scaling", {
      autoScalingConfigurationName: "kin-voice",
      minSize: 1,
      maxSize: 2,
      maxConcurrency: 100,
    });

    // Read by name from KinData's parameters when this stack deploys.
    const setting = (name: string) => ssm.StringParameter.valueForStringParameter(this, name);
    const serviceSecret = setting(DATABASE_SETTINGS.serviceSecretArn);
    const authTokenSecret = setting(TWILIO_SETTINGS.authTokenSecretArn);
    const stateKeySecret = setting(TWILIO_SETTINGS.stateKeySecretArn);

    // Three secrets and nothing else: not the Twilio account SID, not the
    // app, provisioner or admin passwords, not PayPal's. App Runner reads
    // them when it starts the service and never logs them.
    const instance = new iam.Role(this, "Instance", {
      roleName: "kin-voice-instance",
      description: "What Kin's phone service may reach in AWS: the service role's database password, Twilio's auth token and the key that seals a call's token",
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });
    instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [serviceSecret, authTokenSecret, stateKeySecret] }));
    instance.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [setting(DATABASE_SETTINGS.keyArn)],
        conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
      }),
    );

    const environment = [
      { name: "KIN_DATABASE_HOST", value: setting(DATABASE_SETTINGS.host) },
      { name: "KIN_DATABASE_PORT", value: "5432" },
      { name: "KIN_DATABASE_NAME", value: "kin" },
      { name: "KIN_DATABASE_TLS", value: "require" },
      { name: "PORT", value: String(VOICE_PORT) },
      // Twilio signs the address it called, so this must be the address App
      // Runner gave the service: see kin:voicePublicUrl.
      { name: "KIN_VOICE_PUBLIC_URL", value: config.voicePublicUrl ?? VOICE_ADDRESS_PLACEHOLDER },
      // The numbers a parent rings to ask "is it really you?". Unset, the line is not served.
      ...(config.presenceLineNumbers === null ? [] : [{ name: "KIN_PRESENCE_LINE_NUMBERS", value: config.presenceLineNumbers }]),
    ];
    const secrets = [
      { name: "KIN_DATABASE_SERVICE_PASSWORD", value: serviceSecret },
      { name: "KIN_TWILIO_AUTH_TOKEN", value: authTokenSecret },
      { name: "KIN_VOICE_STATE_KEY", value: stateKeySecret },
    ];

    // Out through the web app's connector: Kin's own network, where the database admits Kin's services.
    // App Runner refuses a second connector for the same security group, so it is shared (KinWeb publishes it).
    const connectorArn = setting(SHARED_CONNECTOR.arn);

    const service = new apprunner.CfnService(this, "Service", {
      serviceName: "kin-voice",
      sourceConfiguration: {
        autoDeploymentsEnabled: false,
        authenticationConfiguration: { accessRoleArn: imageAccess.roleArn },
        imageRepository: {
          imageIdentifier: image.imageUri,
          imageRepositoryType: "ECR",
          imageConfiguration: { port: String(VOICE_PORT), runtimeEnvironmentVariables: environment, runtimeEnvironmentSecrets: secrets },
        },
      },
      // The smallest size App Runner offers: the service only answers webhooks.
      instanceConfiguration: { cpu: "0.25 vCPU", memory: "0.5 GB", instanceRoleArn: instance.roleArn },
      networkConfiguration: {
        egressConfiguration: { egressType: "VPC", vpcConnectorArn: connectorArn },
        ingressConfiguration: { isPubliclyAccessible: true },
      },
      healthCheckConfiguration: { protocol: "HTTP", path: "/health", interval: 10, timeout: 5, healthyThreshold: 1, unhealthyThreshold: 5 },
      autoScalingConfigurationArn: scaling.attrAutoScalingConfigurationArn,
    });
    // App Runner pulls the image as it creates the service, so the role's grant must exist first.
    service.node.addDependency(imageAccess);
    // It reads its secrets as it starts, so the instance role's grant must exist first.
    service.node.addDependency(instance);

    new CfnOutput(this, "Url", { value: `https://${service.attrServiceUrl}`, description: "Where Kin's phone service is served: the value of kin:voicePublicUrl" });
  }
}
