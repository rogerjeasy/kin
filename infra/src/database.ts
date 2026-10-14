import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as rds from "aws-cdk-lib/aws-rds";
import { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { denyNeighbours } from "./isolation.ts";
import { SUBNETS } from "./network-stack.ts";

const POSTGRES_PORT = 5432;

type DatabaseProps = {
  readonly config: InfraConfig;
  readonly vpc: ec2.IVpc;
  readonly servicesSecurityGroup: ec2.ISecurityGroup;
  readonly key: kms.IKey;
};

/**
 * Aurora Serverless v2, PostgreSQL, docs/architecture.md section 14.4. Kin's
 * ledger lives here under row-level security. It is reachable only from Kin's
 * services, and its credentials only by Kin's roles.
 */
export class Database extends Construct {
  readonly cluster: rds.DatabaseCluster;

  constructor(scope: Construct, id: string, props: DatabaseProps) {
    super(scope, id);
    const { config, vpc, servicesSecurityGroup, key } = props;

    const securityGroup = new ec2.SecurityGroup(this, "SecurityGroup", {
      vpc,
      securityGroupName: "kin-database",
      description: "Kin Aurora cluster, reachable from Kin services only",
      allowAllOutbound: false,
    });
    securityGroup.addIngressRule(
      servicesSecurityGroup,
      ec2.Port.tcp(POSTGRES_PORT),
      "Kin services",
    );

    this.cluster = new rds.DatabaseCluster(this, "Cluster", {
      clusterIdentifier: "kin",
      engine: rds.DatabaseClusterEngine.auroraPostgres({
        version: rds.AuroraPostgresEngineVersion.VER_17_9,
      }),
      writer: rds.ClusterInstance.serverlessV2("writer"),
      serverlessV2MinCapacity: config.databaseCapacityAcu.min,
      serverlessV2MaxCapacity: config.databaseCapacityAcu.max,
      vpc,
      vpcSubnets: { subnetGroupName: SUBNETS.database },
      securityGroups: [securityGroup],
      port: POSTGRES_PORT,
      defaultDatabaseName: "kin",
      credentials: rds.Credentials.fromGeneratedSecret("kin_admin", {
        secretName: "kin/database/admin",
        encryptionKey: key,
      }),
      storageEncrypted: true,
      storageEncryptionKey: key,
      backup: { retention: Duration.days(7) },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
    });
    this.cluster.secret?.addToResourcePolicy(
      denyNeighbours(this, config, ["secretsmanager:*"], ["*"]),
    );
  }
}
