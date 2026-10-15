import { CfnOutput, IgnoreMode, Stack, type StackProps } from "aws-cdk-lib";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import type { InfraConfig } from "./config.ts";
import { WEB_SETTINGS } from "./web-settings.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/** The origin people reach the app at: the first https origin Cognito may return to. */
export function publicWebOrigin(config: InfraConfig): string | null {
  return config.webOrigins.find((origin) => origin.startsWith("https://")) ?? null;
}

/**
 * The web app on App Runner (docs/architecture.md decision 35). App Runner
 * gives it an https address with no domain, which Cognito requires, and runs
 * the same production build the end-to-end tests run.
 */
export class WebStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);

    // Built from the repository during `cdk deploy`, for App Runner's x86 machines.
    const image = new ecrAssets.DockerImageAsset(this, "Image", {
      directory: repositoryRoot,
      file: "apps/web/Dockerfile",
      platform: ecrAssets.Platform.LINUX_AMD64,
      ignoreMode: IgnoreMode.DOCKER,
    });

    const imageAccess = new iam.Role(this, "ImageAccess", {
      description: "Lets App Runner pull Kin's web image",
      assumedBy: new iam.ServicePrincipal("build.apprunner.amazonaws.com"),
    });
    image.repository.grantPull(imageAccess);

    // One instance always warm, at most two: a demo, not a fleet.
    const scaling = new apprunner.CfnAutoScalingConfiguration(this, "Scaling", {
      autoScalingConfigurationName: "kin-web",
      minSize: 1,
      maxSize: 2,
      maxConcurrency: 100,
    });

    // Read by name from KinData's parameters when this stack deploys.
    const setting = (name: string) => ssm.StringParameter.valueForStringParameter(this, name);
    const origin = publicWebOrigin(config);
    const environment = [
      { name: "KIN_AUTH_ISSUER", value: setting(WEB_SETTINGS.authIssuer) },
      { name: "KIN_AUTH_LOGIN_URL", value: setting(WEB_SETTINGS.authLoginUrl) },
      { name: "KIN_AUTH_CLIENT_ID", value: setting(WEB_SETTINGS.authClientId) },
      // Known only once App Runner has named the service: see kin:webOrigins.
      ...(origin === null ? [] : [{ name: "KIN_WEB_ORIGIN", value: origin }]),
    ];

    const service = new apprunner.CfnService(this, "Service", {
      serviceName: "kin-web",
      sourceConfiguration: {
        autoDeploymentsEnabled: false,
        authenticationConfiguration: { accessRoleArn: imageAccess.roleArn },
        imageRepository: {
          imageIdentifier: image.imageUri,
          imageRepositoryType: "ECR",
          imageConfiguration: { port: "3000", runtimeEnvironmentVariables: environment },
        },
      },
      instanceConfiguration: { cpu: "1 vCPU", memory: "2 GB" },
      healthCheckConfiguration: { protocol: "HTTP", path: "/", interval: 10, timeout: 5, healthyThreshold: 1, unhealthyThreshold: 5 },
      autoScalingConfigurationArn: scaling.attrAutoScalingConfigurationArn,
    });
    // App Runner pulls the image as it creates the service, so the role's grant must exist first.
    service.node.addDependency(imageAccess);

    new CfnOutput(this, "Url", { value: `https://${service.attrServiceUrl}`, description: "Where Kin's web app is served" });
  }
}
