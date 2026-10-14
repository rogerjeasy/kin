import { Stack, type StackProps } from "aws-cdk-lib";
import type * as ec2 from "aws-cdk-lib/aws-ec2";
import * as scheduler from "aws-cdk-lib/aws-scheduler";
import type * as sns from "aws-cdk-lib/aws-sns";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { Database } from "./database.ts";
import { createEncryptionKey } from "./encryption-key.ts";
import { Identity } from "./identity.ts";
import { Queues } from "./queues.ts";
import { createPrivateBucket } from "./storage.ts";

type DataStackProps = StackProps & {
  readonly vpc: ec2.IVpc;
  readonly servicesSecurityGroup: ec2.ISecurityGroup;
  readonly alerts: sns.ITopic;
};

/**
 * Everything that holds Kin's data. All of it is retained if the stack is
 * deleted, and the database also refuses deletion until protection is lifted.
 */
export class DataStack extends Stack {
  constructor(scope: Construct, id: string, config: InfraConfig, props: DataStackProps) {
    super(scope, id, props);

    const key = createEncryptionKey(this, config);
    new Database(this, "Database", {
      config,
      vpc: props.vpc,
      servicesSecurityGroup: props.servicesSecurityGroup,
      key,
    });
    createPrivateBucket(this, "Documents", { config, key, purpose: "documents" });
    createPrivateBucket(this, "Exports", { config, key, purpose: "exports" });
    new Queues(this, "Queues", { config, key, alerts: props.alerts });
    new Identity(this, "Identity", config);

    // Period closes, reminders and calling times are created in this group at
    // run time, one schedule per circle, in the circle's own timezone.
    new scheduler.CfnScheduleGroup(this, "Schedules", { name: "kin" });
  }
}
