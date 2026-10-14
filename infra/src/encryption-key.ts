import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as kms from "aws-cdk-lib/aws-kms";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The one key that encrypts Kin's database, documents, queues and secrets.
 * No other project in the account is granted it, and the neighbour deny makes
 * that explicit, so even a copied object or snapshot cannot be read elsewhere.
 */
export function createEncryptionKey(
  scope: Construct,
  config: InfraConfig,
): kms.Key {
  const key = new kms.Key(scope, "Key", {
    alias: "alias/kin",
    description: "Encrypts every Kin data store",
    enableKeyRotation: true,
    rotationPeriod: Duration.days(365),
    removalPolicy: RemovalPolicy.RETAIN,
  });
  key.addToResourcePolicy(denyNeighbours(scope, config, ["kms:*"], ["*"]));
  return key;
}
