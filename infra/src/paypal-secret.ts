import { RemovalPolicy } from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import type * as sqs from "aws-cdk-lib/aws-sqs";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { PAYPAL_SETTINGS } from "./database-settings.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The slot for the pool app's PayPal client secret, and where the PayPal
 * inbox queue is, published for the web app and the worker. The slot exists
 * before top-ups are switched on, so the secret can be stored first.
 */
export function createPayPalSettings(scope: Construct, config: InfraConfig, key: kms.IKey, inbox: sqs.IQueue): void {
  const secret = new secretsmanager.Secret(scope, "PayPalClientSecret", {
    secretName: PAYPAL_SETTINGS.secretName,
    description: "Client secret of the pool's PayPal sandbox app. Set it with pnpm --filter @kin/infra run paypal:store.",
    encryptionKey: key,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  secret.addToResourcePolicy(denyNeighbours(scope, config, ["secretsmanager:*"], ["*"]));
  const value = (id: string, parameterName: string, stringValue: string) => new ssm.StringParameter(scope, id, { parameterName, stringValue });
  value("PayPalSecretArn", PAYPAL_SETTINGS.secretArn, secret.secretArn);
  value("PayPalInboxUrl", PAYPAL_SETTINGS.inboxUrl, inbox.queueUrl);
  value("PayPalInboxArn", PAYPAL_SETTINGS.inboxArn, inbox.queueArn);
}
