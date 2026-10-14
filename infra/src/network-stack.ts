import { Stack, type StackProps } from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";

/** Subnet group names, read by the stacks that place resources in them. */
export const SUBNETS = {
  public: "public",
  services: "services",
  database: "database",
} as const;

/**
 * Kin's own network, docs/architecture.md section 14.2. Services and the
 * database have no public address, and the database subnets have no route to
 * the internet at all.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  /** Carried by every Kin service task. The database admits only this group. */
  readonly servicesSecurityGroup: ec2.SecurityGroup;

  private readonly zones: readonly string[];

  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);
    this.zones = config.availabilityZones;

    this.vpc = new ec2.Vpc(this, "Vpc", {
      vpcName: "kin",
      ipAddresses: ec2.IpAddresses.cidr("10.40.0.0/16"),
      maxAzs: config.availabilityZones.length,
      // One NAT gateway, not one per zone: the outbound calls are retried
      // anyway, and a second gateway doubles a fixed hourly cost.
      natGateways: 1,
      subnetConfiguration: [
        { name: SUBNETS.public, subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        {
          name: SUBNETS.services,
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
          cidrMask: 22,
        },
        {
          name: SUBNETS.database,
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
      // Free, and keeps document uploads and reads off the NAT gateway.
      gatewayEndpoints: {
        s3: { service: ec2.GatewayVpcEndpointAwsService.S3 },
      },
    });

    this.servicesSecurityGroup = new ec2.SecurityGroup(this, "Services", {
      vpc: this.vpc,
      securityGroupName: "kin-services",
      description: "Kin web, voice and worker tasks",
      allowAllOutbound: true,
    });
  }

  // The zones come from configuration, so synth never needs to ask AWS which
  // zones the account has, and a test can build the stack offline.
  override get availabilityZones(): string[] {
    return [...this.zones];
  }
}
