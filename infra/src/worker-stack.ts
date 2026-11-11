import { Duration, IgnoreMode, RemovalPolicy, Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import { DATABASE_SETTINGS, DEMO_MERCHANT_SETTINGS, MIGRATION_TASK, PAYPAL_SETTINGS, TWILIO_SETTINGS } from "./database-settings.ts";
import { SUBNETS } from "./network-stack.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

type WorkerStackProps = StackProps & {
  readonly vpc: ec2.IVpc;
  readonly servicesSecurityGroup: ec2.ISecurityGroup;
  readonly paypal: { readonly clientId: string; readonly webhookId: string };
  /** Kin's own PayPal sandbox account, to which approved demo caregiver payouts are paid; `null` keeps them simulated. */
  readonly demoSandboxPayeeEmail: string | null;
  /**
   * Kin's phone call to a parent about a shift: the number it calls from and the phone service's address.
   * `null` leaves the call loop off, and the worker with no Twilio setting at all. Given only when
   * the phone service, a number and its address all exist (`callLoopOn` in config.ts).
   */
  readonly shiftCall: { readonly callerNumber: string; readonly publicUrl: string } | null;
  /**
   * The texts to a family member for "is it really you?": the sender and the web app's public address. `null` leaves
   * them queued. Given only when the PayPal app, a sender and the web app's https address all exist (`presenceTextSettings`).
   */
  readonly presenceTexts: { readonly from: string; readonly webUrl: string } | null;
  /** The demo pharmacy's https address (KinDemoMerchant's, by cross-stack reference); `null` keeps the seller simulated in process. */
  readonly demoMerchantUrl: string | null;
};

/**
 * Kin's worker (docs/architecture.md section 4): one small Fargate task that
 * long-polls the PayPal inbox and writes what PayPal confirms to the ledger,
 * as Kin's service identity. It is the only process that holds the service
 * role's password. It serves nothing, so it has no load balancer and no
 * inbound traffic; it reaches PayPal through the NAT gateway.
 */
export class WorkerStack extends Stack {
  constructor(scope: Construct, id: string, props: WorkerStackProps) {
    super(scope, id, props);
    const setting = (name: string) => ssm.StringParameter.valueForStringParameter(this, name);
    const secret = (id: string, parameter: string) => secretsmanager.Secret.fromSecretCompleteArn(this, id, setting(parameter));

    const executionRole = new iam.Role(this, "ExecutionRole", { roleName: "kin-worker-execution", assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com") });
    const taskRole = new iam.Role(this, "TaskRole", {
      roleName: "kin-worker-task",
      description: "What Kin's worker may do in AWS: take messages off the PayPal inbox",
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });
    taskRole.addToPolicy(
      new iam.PolicyStatement({ actions: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:ChangeMessageVisibility", "sqs:GetQueueAttributes"], resources: [setting(PAYPAL_SETTINGS.inboxArn)] }),
    );
    taskRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [setting(DATABASE_SETTINGS.keyArn)],
        conditions: { StringEquals: { "kms:ViaService": `sqs.${this.region}.amazonaws.com` } },
      }),
    );
    // Reading the two secrets at start-up needs the key they are encrypted with.
    executionRole.addToPolicy(
      new iam.PolicyStatement({
        actions: ["kms:Decrypt"],
        resources: [setting(DATABASE_SETTINGS.keyArn)],
        conditions: { StringEquals: { "kms:ViaService": `secretsmanager.${this.region}.amazonaws.com` } },
      }),
    );

    const task = new ecs.FargateTaskDefinition(this, "Task", {
      family: "kin-worker",
      // The smallest Fargate size, on Graviton: about seven dollars a month.
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.ARM64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      executionRole,
      taskRole,
    });
    task.addContainer("Worker", {
      containerName: "worker",
      image: ecs.ContainerImage.fromDockerImageAsset(
        new ecrAssets.DockerImageAsset(this, "Image", {
          directory: repositoryRoot,
          file: "apps/worker/Dockerfile",
          platform: ecrAssets.Platform.LINUX_ARM64,
          ignoreMode: IgnoreMode.DOCKER,
        }),
      ),
      essential: true,
      environment: {
        KIN_DATABASE_HOST: setting(DATABASE_SETTINGS.host),
        KIN_DATABASE_PORT: "5432",
        KIN_DATABASE_NAME: "kin",
        KIN_DATABASE_TLS: "require",
        KIN_PAYPAL_CLIENT_ID: props.paypal.clientId,
        KIN_PAYPAL_WEBHOOK_ID: props.paypal.webhookId,
        KIN_PAYPAL_INBOX_URL: setting(PAYPAL_SETTINGS.inboxUrl),
        AWS_REGION: this.region,
        ...(props.demoSandboxPayeeEmail === null ? {} : { KIN_DEMO_SANDBOX_PAYEE_EMAIL: props.demoSandboxPayeeEmail }),
        ...(props.shiftCall === null ? {} : { KIN_TWILIO_CALLER_NUMBER: props.shiftCall.callerNumber, KIN_VOICE_PUBLIC_URL: props.shiftCall.publicUrl }),
        ...(props.presenceTexts === null ? {} : { KIN_TWILIO_SMS_FROM: props.presenceTexts.from, KIN_WEB_PUBLIC_URL: props.presenceTexts.webUrl }),
        ...(props.demoMerchantUrl === null ? {} : { KIN_DEMO_MERCHANT_URL: props.demoMerchantUrl }),
      },
      secrets: {
        KIN_DATABASE_SERVICE_PASSWORD: ecs.Secret.fromSecretsManager(secret("ServicePassword", DATABASE_SETTINGS.serviceSecretArn)),
        KIN_PAYPAL_CLIENT_SECRET: ecs.Secret.fromSecretsManager(secret("PayPalSecret", PAYPAL_SETTINGS.secretArn)),
        // The call loop dials with the account's SID and token, and seals each call's token with the key the phone service opens it with.
        // The texts to a family member need the account too, and nothing of the phone service's key.
        ...(props.shiftCall === null && props.presenceTexts === null
          ? {}
          : {
              KIN_TWILIO_ACCOUNT_SID: ecs.Secret.fromSecretsManager(secret("TwilioAccountSid", TWILIO_SETTINGS.accountSidSecretArn)),
              KIN_TWILIO_AUTH_TOKEN: ecs.Secret.fromSecretsManager(secret("TwilioAuthToken", TWILIO_SETTINGS.authTokenSecretArn)),
            }),
        ...(props.shiftCall === null ? {} : { KIN_VOICE_STATE_KEY: ecs.Secret.fromSecretsManager(secret("VoiceStateKey", TWILIO_SETTINGS.stateKeySecretArn)) }),
        // Every request to the demo pharmacy is signed with the secret it checks; nothing else of the pharmacy's.
        ...(props.demoMerchantUrl === null ? {} : { KIN_DEMO_MERCHANT_SIGNING_SECRET: ecs.Secret.fromSecretsManager(secret("DemoMerchantSigningSecret", DEMO_MERCHANT_SETTINGS.signingSecretArn)) }),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "worker",
        logGroup: new logs.LogGroup(this, "Logs", { logGroupName: "/kin/worker", retention: logs.RetentionDays.ONE_MONTH, removalPolicy: RemovalPolicy.DESTROY }),
      }),
      // Time to finish the message in hand when a deployment stops the task.
      stopTimeout: Duration.seconds(30),
    });

    new ecs.FargateService(this, "Service", {
      serviceName: "kin-worker",
      cluster: ecs.Cluster.fromClusterAttributes(this, "Cluster", { clusterName: MIGRATION_TASK.cluster, vpc: props.vpc }),
      taskDefinition: task,
      desiredCount: 1,
      // One consumer at a time: a deployment stops the old task before the new one starts.
      minHealthyPercent: 0,
      maxHealthyPercent: 100,
      circuitBreaker: { rollback: true },
      assignPublicIp: false,
      // Beside the web app's connector, in the group the database admits.
      vpcSubnets: { subnetGroupName: SUBNETS.services },
      securityGroups: [props.servicesSecurityGroup],
    });
  }
}
