import { CfnOutput, IgnoreMode, Stack, type StackProps } from "aws-cdk-lib";
import * as apprunner from "aws-cdk-lib/aws-apprunner";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as iam from "aws-cdk-lib/aws-iam";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import type { InfraConfig } from "./config.ts";
import { DATABASE_SETTINGS, PAYPAL_SETTINGS, SHARED_CONNECTOR, TWILIO_SETTINGS } from "./database-settings.ts";
import { WEB_SETTINGS } from "./web-settings.ts";
import { POOL_ADMIN_ACTIONS } from "./account-groups.ts";
import { GMAIL_SECRET_ARN_PARAMETER } from "./gmail-secret-name.ts";

/** Claude Opus 4.6 as a US cross-region inference profile, and the foundation model it routes to. Matches `BEDROCK_INVOKE_DEFAULT_MODEL` in `@kin/config`. */
const CLAUDE_INFERENCE_PROFILE = "us.anthropic.claude-opus-4-6-v1";
const CLAUDE_FOUNDATION_MODEL = "anthropic.claude-opus-4-6-v1";

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
      { name: "KIN_DATABASE_HOST", value: setting(DATABASE_SETTINGS.host) },
      { name: "KIN_DATABASE_PORT", value: "5432" },
      { name: "KIN_DATABASE_NAME", value: "kin" },
      { name: "KIN_DATABASE_TLS", value: "require" },
      // The hosted app is the demo environment (docs/architecture.md section 20.3).
      { name: "KIN_DEMO_CIRCLES", value: "on" },
      // The instance role below may add people to account type groups in Kin's pool.
      { name: "KIN_AUTH_ASSIGN_GROUPS", value: "on" },
    ];

    // The web app is a person's agent: it holds the person's role and the
    // demo provisioner, never the admin's or the service's password. App
    // Runner reads the two secrets when it deploys and never logs them.
    const appSecret = setting(DATABASE_SETTINGS.appSecretArn);
    const provisionerSecret = setting(DATABASE_SETTINGS.provisionerSecretArn);
    const demoSessionKey = setting(DATABASE_SETTINGS.demoSessionKeyArn);
    const instance = new iam.Role(this, "Instance", {
      roleName: "kin-web-instance",
      description: "What Kin's web app may reach in AWS: its database passwords, the demo session key, PayPal's secret and inbox when top-ups are on, and Twilio's credentials when texting is on",
      assumedBy: new iam.ServicePrincipal("tasks.apprunner.amazonaws.com"),
    });
    instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [appSecret, provisionerSecret, demoSessionKey] }));
    // What the web app may do to Kin's user pool, with its own identity: add a
    // person who holds a caregiver's seat, or an account made before every
    // sign-up got the default type, to that group (packages/auth
    // `accountTypesOwed`; IAM cannot limit the group, so the code names the only
    // two it grants), and read whether a person has an authenticator app.
    instance.addToPolicy(new iam.PolicyStatement({ actions: [...POOL_ADMIN_ACTIONS], resources: [setting(WEB_SETTINGS.authUserPoolArn)] }));
    instance.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [setting(DATABASE_SETTINGS.keyArn)],
        conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
      }),
    );
    const secrets = [
      { name: "KIN_DATABASE_APP_PASSWORD", value: appSecret },
      { name: "KIN_DATABASE_PROVISIONER_PASSWORD", value: provisionerSecret },
      { name: "KIN_DEMO_SESSION_KEY", value: demoSessionKey },
    ];

    // Top-ups: the web opens and captures orders with the pool's PayPal app,
    // and hands what it captured to the worker's queue. It may send to that
    // queue and do nothing else with it.
    if (config.paypal !== null) {
      const paypalSecret = setting(PAYPAL_SETTINGS.secretArn);
      instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [paypalSecret] }));
      instance.addToPolicy(new iam.PolicyStatement({ actions: ["sqs:SendMessage"], resources: [setting(PAYPAL_SETTINGS.inboxArn)] }));
      instance.addToPolicy(
        new iam.PolicyStatement({
          actions: ["kms:GenerateDataKey", "kms:Decrypt"],
          resources: [setting(DATABASE_SETTINGS.keyArn)],
          conditions: { StringEquals: { "kms:ViaService": `sqs.${this.region}.amazonaws.com` } },
        }),
      );
      environment.push(
        { name: "KIN_PAYPAL_CLIENT_ID", value: config.paypal.clientId },
        { name: "KIN_PAYPAL_INBOX_URL", value: setting(PAYPAL_SETTINGS.inboxUrl) },
        { name: "AWS_REGION", value: this.region },
      );
      secrets.push({ name: "KIN_PAYPAL_CLIENT_SECRET", value: paypalSecret });
      // The web only says how demo payouts are paid; the worker pays them.
      if (config.demoSandboxPayeeEmail !== null) environment.push({ name: "KIN_DEMO_SANDBOX_PAYEE_EMAIL", value: config.demoSandboxPayeeEmail });
    }

    // The email that tells a person an authenticator app was just set up on
    // their account: from the Gmail account that sends sign-in codes. Unset,
    // the app is still set up and the email is skipped, with a log line.
    if (config.senderEmail !== null) {
      const gmailSecret = setting(GMAIL_SECRET_ARN_PARAMETER);
      instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [gmailSecret] }));
      environment.push({ name: "KIN_SENDER_EMAIL", value: config.senderEmail });
      secrets.push({ name: "KIN_GMAIL_APP_PASSWORD", value: gmailSecret });
    }

    // Texting a check-in link: the web app sends the message itself with
    // Twilio's account, so it reads the account SID and the auth token, and
    // nothing of the phone service's. Unset, the button is not shown.
    if (config.twilioSmsFrom !== null) {
      const accountSidSecret = setting(TWILIO_SETTINGS.accountSidSecretArn);
      const authTokenSecret = setting(TWILIO_SETTINGS.authTokenSecretArn);
      instance.addToPolicy(new iam.PolicyStatement({ actions: ["secretsmanager:GetSecretValue"], resources: [accountSidSecret, authTokenSecret] }));
      environment.push({ name: "KIN_TWILIO_SMS_FROM", value: config.twilioSmsFrom });
      secrets.push({ name: "KIN_TWILIO_ACCOUNT_SID", value: accountSidSecret }, { name: "KIN_TWILIO_AUTH_TOKEN", value: authTokenSecret });
    }

    // Speech: Transcribe hears a recording and Polly reads Kin's own words
    // aloud. Neither action names a resource, so neither can be narrowed.
    if (config.speech) {
      instance.addToPolicy(new iam.PolicyStatement({ actions: ["transcribe:StartStreamTranscription", "polly:SynthesizeSpeech"], resources: ["*"] }));
      environment.push({ name: "KIN_SPEECH_REGION", value: this.region });
    }

    // Claude: Opus 4.6 through Bedrock Runtime's InvokeModel, because this
    // account is not entitled to Opus 5.5 on the Mantle endpoint (decision 67).
    // The cross-region inference profile in this account is named, and so are
    // the foundation models it routes to, but only when called through that
    // profile. The Marketplace subscription a model's first call makes is
    // allowed only when Bedrock itself makes it.
    if (config.claude) {
      const profileArn = `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${CLAUDE_INFERENCE_PROFILE}`;
      instance.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources: [profileArn],
        }),
      );
      instance.addToPolicy(
        new iam.PolicyStatement({
          actions: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          resources: [`arn:aws:bedrock:*::foundation-model/${CLAUDE_FOUNDATION_MODEL}`],
          conditions: { StringEquals: { "bedrock:InferenceProfileArn": profileArn } },
        }),
      );
      instance.addToPolicy(
        new iam.PolicyStatement({
          actions: ["aws-marketplace:Subscribe", "aws-marketplace:ViewSubscriptions"],
          resources: ["*"],
          conditions: { StringEquals: { "aws:CalledViaLast": "bedrock.amazonaws.com" } },
        }),
      );
      environment.push(
        { name: "KIN_BEDROCK_REGION", value: this.region },
        { name: "KIN_BEDROCK_API", value: "invoke" },
        { name: "KIN_BEDROCK_MODEL", value: CLAUDE_INFERENCE_PROFILE },
      );
    }

    // Out through Kin's own network, where the database admits Kin's
    // services and the NAT gateway reaches Cognito.
    const connector = new apprunner.CfnVpcConnector(this, "Network", {
      vpcConnectorName: "kin-web",
      subnets: ssm.StringListParameter.valueForTypedListParameter(this, DATABASE_SETTINGS.servicesSubnets),
      securityGroups: [setting(DATABASE_SETTINGS.servicesSecurityGroup)],
    });

    // App Runner allows one connector per network and security group, so the phone service uses this one.
    new ssm.StringParameter(this, "ConnectorArn", { parameterName: SHARED_CONNECTOR.arn, stringValue: connector.attrVpcConnectorArn });

    const service = new apprunner.CfnService(this, "Service", {
      serviceName: "kin-web",
      sourceConfiguration: {
        autoDeploymentsEnabled: false,
        authenticationConfiguration: { accessRoleArn: imageAccess.roleArn },
        imageRepository: {
          imageIdentifier: image.imageUri,
          imageRepositoryType: "ECR",
          imageConfiguration: { port: "3000", runtimeEnvironmentVariables: environment, runtimeEnvironmentSecrets: secrets },
        },
      },
      instanceConfiguration: { cpu: "1 vCPU", memory: "2 GB", instanceRoleArn: instance.roleArn },
      networkConfiguration: {
        egressConfiguration: { egressType: "VPC", vpcConnectorArn: connector.attrVpcConnectorArn },
        ingressConfiguration: { isPubliclyAccessible: true },
      },
      healthCheckConfiguration: { protocol: "HTTP", path: "/", interval: 10, timeout: 5, healthyThreshold: 1, unhealthyThreshold: 5 },
      autoScalingConfigurationArn: scaling.attrAutoScalingConfigurationArn,
    });
    // App Runner pulls the image as it creates the service, so the role's grant must exist first.
    service.node.addDependency(imageAccess);
    // It reads its secrets as it starts, so the instance role's grant must exist first.
    service.node.addDependency(instance);

    new CfnOutput(this, "Url", { value: `https://${service.attrServiceUrl}`, description: "Where Kin's web app is served" });
  }
}
