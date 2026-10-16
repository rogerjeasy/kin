import { Duration, IgnoreMode, RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecrAssets from "aws-cdk-lib/aws-ecr-assets";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as logs from "aws-cdk-lib/aws-logs";
import type * as rds from "aws-cdk-lib/aws-rds";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import type { InfraConfig } from "./config.ts";
import { DATABASE_ROLES, DATABASE_SETTINGS, MIGRATION_TASK, type DatabaseRole } from "./database-settings.ts";
import { denyNeighbours } from "./isolation.ts";
import { SUBNETS } from "./network-stack.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

type DatabaseAccessProps = {
  readonly config: InfraConfig;
  readonly cluster: rds.DatabaseCluster;
  readonly vpc: ec2.IVpc;
  readonly servicesSecurityGroup: ec2.ISecurityGroup;
  readonly key: kms.IKey;
};

/**
 * Who may use the database, and how it is brought up to date. Each service
 * role has its own password in Secrets Manager. The migration runs as a
 * one-off Fargate task in the services subnets (docs/architecture.md section
 * 14.4): it alone reads the admin's password, and it sets the others'.
 */
export class DatabaseAccess extends Construct {
  readonly roleSecrets: Readonly<Record<DatabaseRole, secretsmanager.Secret>>;

  constructor(scope: Construct, id: string, props: DatabaseAccessProps) {
    super(scope, id);
    const { config, key } = props;

    this.roleSecrets = Object.fromEntries(
      DATABASE_ROLES.map((role) => {
        const secret = new secretsmanager.Secret(this, `${role}Password`, {
          secretName: `kin/database/${role}`,
          description: `Password of the kin_${role} database role. The migration task sets it on the role.`,
          encryptionKey: key,
          // A plain string, so App Runner and ECS can hand it over whole.
          generateSecretString: { passwordLength: 40, excludePunctuation: true },
          removalPolicy: RemovalPolicy.RETAIN,
        });
        secret.addToResourcePolicy(denyNeighbours(this, config, ["secretsmanager:*"], ["*"]));
        return [role, secret];
      }),
    ) as Record<DatabaseRole, secretsmanager.Secret>;

    this.createMigrationTask(props);
    this.publishSettings(props);
  }

  private createMigrationTask({ cluster, vpc }: DatabaseAccessProps): void {
    const admin = cluster.secret;
    if (!admin) throw new Error("The database cluster has no admin secret");

    new ecs.Cluster(this, "Cluster", { clusterName: MIGRATION_TASK.cluster, vpc, containerInsightsV2: ecs.ContainerInsights.DISABLED });
    const task = new ecs.FargateTaskDefinition(this, "Migrate", {
      family: MIGRATION_TASK.family,
      cpu: 256,
      memoryLimitMiB: 512,
      runtimePlatform: { cpuArchitecture: ecs.CpuArchitecture.X86_64, operatingSystemFamily: ecs.OperatingSystemFamily.LINUX },
      executionRole: new iam.Role(this, "MigrateExecution", {
        roleName: MIGRATION_TASK.executionRole,
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      }),
      taskRole: new iam.Role(this, "MigrateTask", {
        roleName: MIGRATION_TASK.taskRole,
        description: "The migration task needs no AWS access of its own",
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      }),
    });
    task.addContainer("Container", {
      containerName: MIGRATION_TASK.container,
      image: ecs.ContainerImage.fromDockerImageAsset(
        new ecrAssets.DockerImageAsset(this, "Image", {
          directory: repositoryRoot,
          file: "packages/db/Dockerfile",
          platform: ecrAssets.Platform.LINUX_AMD64,
          ignoreMode: IgnoreMode.DOCKER,
        }),
      ),
      essential: true,
      environment: {
        KIN_DATABASE_HOST: cluster.clusterEndpoint.hostname,
        KIN_DATABASE_PORT: String(cluster.clusterEndpoint.port),
        KIN_DATABASE_NAME: "kin",
        KIN_DATABASE_TLS: "require",
      },
      secrets: {
        KIN_DATABASE_ADMIN_USER: ecs.Secret.fromSecretsManager(admin, "username"),
        KIN_DATABASE_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(admin, "password"),
        KIN_DATABASE_APP_PASSWORD: ecs.Secret.fromSecretsManager(this.roleSecrets.app),
        KIN_DATABASE_SERVICE_PASSWORD: ecs.Secret.fromSecretsManager(this.roleSecrets.service),
        KIN_DATABASE_PROVISIONER_PASSWORD: ecs.Secret.fromSecretsManager(this.roleSecrets.provisioner),
      },
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: "migrate",
        logGroup: new logs.LogGroup(this, "MigrateLogs", {
          logGroupName: "/kin/database-migrate",
          retention: logs.RetentionDays.ONE_MONTH,
          removalPolicy: RemovalPolicy.DESTROY,
        }),
      }),
      stopTimeout: Duration.seconds(30),
    });
  }

  private publishSettings({ cluster, vpc, servicesSecurityGroup, key }: DatabaseAccessProps): void {
    const value = (id: string, parameterName: string, stringValue: string) => new ssm.StringParameter(this, id, { parameterName, stringValue });
    value("Host", DATABASE_SETTINGS.host, cluster.clusterEndpoint.hostname);
    value("AppSecret", DATABASE_SETTINGS.appSecretArn, this.roleSecrets.app.secretArn);
    value("ProvisionerSecret", DATABASE_SETTINGS.provisionerSecretArn, this.roleSecrets.provisioner.secretArn);
    value("ServiceSecret", DATABASE_SETTINGS.serviceSecretArn, this.roleSecrets.service.secretArn);
    value("Key", DATABASE_SETTINGS.keyArn, key.keyArn);
    value("SecurityGroup", DATABASE_SETTINGS.servicesSecurityGroup, servicesSecurityGroup.securityGroupId);
    new ssm.StringListParameter(this, "Subnets", {
      parameterName: DATABASE_SETTINGS.servicesSubnets,
      stringListValue: vpc.selectSubnets({ subnetGroupName: SUBNETS.services }).subnetIds,
    });
  }
}
