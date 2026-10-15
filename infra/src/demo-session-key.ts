import { RemovalPolicy } from "aws-cdk-lib";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import * as ssm from "aws-cdk-lib/aws-ssm";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { DATABASE_SETTINGS } from "./database-settings.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The key that signs a demo visitor's session (packages/auth/src/demo-session.ts).
 * Generated in Secrets Manager and read by the web app when it deploys.
 */
export function createDemoSessionKey(scope: Construct, config: InfraConfig, key: kms.IKey): secretsmanager.Secret {
  const secret = new secretsmanager.Secret(scope, "DemoSessionKey", {
    secretName: "kin/web/demo-session-key",
    description: "Signs the sessions of anonymous visitors to Kin's demo",
    encryptionKey: key,
    generateSecretString: { passwordLength: 64, excludePunctuation: true },
    removalPolicy: RemovalPolicy.RETAIN,
  });
  secret.addToResourcePolicy(denyNeighbours(scope, config, ["secretsmanager:*"], ["*"]));
  new ssm.StringParameter(scope, "DemoSessionKeyArn", { parameterName: DATABASE_SETTINGS.demoSessionKeyArn, stringValue: secret.secretArn });
  return secret;
}
