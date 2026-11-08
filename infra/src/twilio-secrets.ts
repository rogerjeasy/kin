import { RemovalPolicy } from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { TWILIO_SETTINGS } from "./database-settings.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The three secrets of Kin's phone call to a parent, and where they are,
 * published for KinVoice, KinWorker and KinWeb. They exist before the voice
 * service is switched on, so the Twilio credentials can be stored first.
 *
 * The account SID and the auth token are slots: until `twilio:store` fills
 * them they hold the random value CDK generates. A service that starts with
 * that value fails Twilio's signature check on every request, which is safe.
 * The state key is generated and is never typed or copied anywhere.
 */
export function createTwilioSettings(scope: Construct, config: InfraConfig, key: kms.IKey): void {
  const store = (id: string, secretName: string, arnParameter: string, description: string, generated: secretsmanager.SecretProps["generateSecretString"]) => {
    const secret = new secretsmanager.Secret(scope, id, {
      secretName,
      description,
      encryptionKey: key,
      ...(generated === undefined ? {} : { generateSecretString: generated }),
      removalPolicy: RemovalPolicy.RETAIN,
    });
    secret.addToResourcePolicy(denyNeighbours(scope, config, ["secretsmanager:*"], ["*"]));
    new ssm.StringParameter(scope, `${id}Arn`, { parameterName: arnParameter, stringValue: secret.secretArn });
  };
  store("TwilioAccountSid", TWILIO_SETTINGS.accountSidSecretName, TWILIO_SETTINGS.accountSidSecretArn, "Kin's Twilio account SID. Set it with pnpm --filter @kin/infra run twilio:store.", undefined);
  store("TwilioAuthToken", TWILIO_SETTINGS.authTokenSecretName, TWILIO_SETTINGS.authTokenSecretArn, "Kin's Twilio auth token. Set it with pnpm --filter @kin/infra run twilio:store.", undefined);
  store(
    "VoiceStateKey",
    TWILIO_SETTINGS.stateKeySecretName,
    TWILIO_SETTINGS.stateKeySecretArn,
    "Seals the token of Kin's call to a parent. The worker and the voice service read this same value.",
    { passwordLength: 64, excludePunctuation: true },
  );
}
