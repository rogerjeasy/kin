import { RemovalPolicy } from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { DEMO_MERCHANT_SETTINGS } from "./database-settings.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The demo pharmacy's four secrets, and where they are, published for
 * KinDemoMerchant and KinWorker. Made only with `kin:demoMerchant`, so
 * nothing changes while it is off.
 *
 * The PayPal client ID and secret and the vault ID are slots: until
 * `merchant:store` fills them they hold a random value of letters and digits,
 * which the pharmacy accepts as well-formed and PayPal refuses, so the
 * pharmacy starts, charges nothing and the worker keeps the refill waiting.
 * The signing secret is generated and is never typed or copied anywhere.
 */
export function createDemoMerchantSettings(scope: Construct, config: InfraConfig, key: kms.IKey): void {
  if (!config.demoMerchant) return;
  const store = (id: string, secretName: string, arnParameter: string, description: string) => {
    const secret = new secretsmanager.Secret(scope, id, {
      secretName,
      description,
      encryptionKey: key,
      generateSecretString: { passwordLength: 64, excludePunctuation: true },
      removalPolicy: RemovalPolicy.RETAIN,
    });
    secret.addToResourcePolicy(denyNeighbours(scope, config, ["secretsmanager:*"], ["*"]));
    new ssm.StringParameter(scope, `${id}Arn`, { parameterName: arnParameter, stringValue: secret.secretArn });
  };
  const filled = "Set it with pnpm --filter @kin/infra run merchant:store.";
  store("DemoMerchantClientId", DEMO_MERCHANT_SETTINGS.clientIdSecretName, DEMO_MERCHANT_SETTINGS.clientIdSecretArn, `The demo pharmacy's PayPal sandbox client ID. ${filled}`);
  store("DemoMerchantClientSecret", DEMO_MERCHANT_SETTINGS.clientSecretSecretName, DEMO_MERCHANT_SETTINGS.clientSecretSecretArn, `The demo pharmacy's PayPal sandbox client secret. ${filled}`);
  store("DemoMerchantVaultId", DEMO_MERCHANT_SETTINGS.vaultIdSecretName, DEMO_MERCHANT_SETTINGS.vaultIdSecretArn, `The PayPal payment token Rose's saved payment method is stored under. ${filled}`);
  store("DemoMerchantSigningSecret", DEMO_MERCHANT_SETTINGS.signingSecretName, DEMO_MERCHANT_SETTINGS.signingSecretArn, "Signs every request Kin's worker sends the demo pharmacy. The worker and the pharmacy read this same value.");
}
