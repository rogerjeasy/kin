import { Duration, RemovalPolicy } from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as s3 from "aws-cdk-lib/aws-s3";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * A private, encrypted, versioned bucket, docs/architecture.md section 14.6.
 * Objects are reached only through short-lived signed links made by Kin's
 * services.
 */
export function createPrivateBucket(
  scope: Construct,
  id: string,
  props: { config: InfraConfig; key: kms.IKey; purpose: string },
): s3.Bucket {
  const { config, key, purpose } = props;
  const bucket = new s3.Bucket(scope, id, {
    bucketName: `kin-${purpose}-${config.account}`,
    blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
    objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
    encryption: s3.BucketEncryption.KMS,
    encryptionKey: key,
    bucketKeyEnabled: true,
    enforceSSL: true,
    versioned: true,
    lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(7) }],
    removalPolicy: RemovalPolicy.RETAIN,
  });
  bucket.addToResourcePolicy(
    denyNeighbours(scope, config, ["s3:*"], [bucket.bucketArn, bucket.arnForObjects("*")]),
  );
  return bucket;
}
