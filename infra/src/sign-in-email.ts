import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import type * as kms from "aws-cdk-lib/aws-kms";
import * as lambda from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";
import { fileURLToPath } from "node:url";

import type { InfraConfig } from "./config.ts";
import { GMAIL_SECRET_NAME } from "./gmail-secret-name.ts";
import { denyNeighbours } from "./isolation.ts";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

/**
 * The secret slot for the Gmail app password. It exists before email codes
 * are switched on, so the password can be stored first and nobody is ever
 * sent to a sender that cannot sign in.
 */
export function createGmailSecret(scope: Construct, config: InfraConfig, key: kms.IKey): secretsmanager.Secret {
  const secret = new secretsmanager.Secret(scope, "GmailAppPassword", {
    secretName: GMAIL_SECRET_NAME,
    description: "Google app password of the Gmail account that sends Kin's sign-in email. Set it with pnpm --filter @kin/infra run gmail:store.",
    encryptionKey: key,
    removalPolicy: RemovalPolicy.RETAIN,
  });
  secret.addToResourcePolicy(denyNeighbours(scope, config, ["secretsmanager:*"], ["*"]));
  return secret;
}

type SignInEmailSenderProps = {
  readonly senderEmail: string;
  readonly secret: secretsmanager.ISecret;
  /** Kin's key. Cognito encrypts each code with it before handing it over. */
  readonly key: kms.IKey;
};

/**
 * Cognito's custom email sender: a function that receives every code Cognito
 * would email, encrypted, and sends it from Kin's Gmail account. Cognito can
 * then offer sign-in by email code without Amazon SES.
 */
export class SignInEmailSender extends Construct {
  readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: SignInEmailSenderProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, "Function", {
      functionName: "kin-sign-in-email",
      description: "Sends Cognito's sign-in codes from Kin's Gmail account",
      entry: `${repositoryRoot}apps/worker/src/cognito-email-sender/lambda.ts`,
      projectRoot: repositoryRoot,
      depsLockFilePath: `${repositoryRoot}pnpm-lock.yaml`,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(15),
      environment: {
        KIN_SENDER_EMAIL: props.senderEmail,
        KIN_GMAIL_SECRET_ARN: props.secret.secretArn,
        KIN_CODES_KEY_ARN: props.key.keyArn,
      },
      // The runtime carries the AWS SDK, so it is left out of the bundle.
      bundling: { externalModules: ["@aws-sdk/*"], minify: true, sourceMap: false },
      logGroup: new logs.LogGroup(this, "Logs", {
        logGroupName: "/aws/lambda/kin-sign-in-email",
        retention: logs.RetentionDays.ONE_MONTH,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    props.secret.grantRead(this.function);
  }

  /**
   * Lets the function decrypt codes that Cognito encrypted for this user pool,
   * and nothing else the key protects: the pool's ID is in every code's
   * encryption context.
   */
  allowCodesOf(userPoolId: string, key: kms.IKey): void {
    const role = this.function.role;
    if (!role) throw new Error("The sign-in email function has no role");
    // A policy of its own, not the role's default one: the function must not
    // wait for the user pool that waits for the function.
    new iam.Policy(this, "DecryptCodes", {
      roles: [role],
      statements: [
        new iam.PolicyStatement({
          actions: ["kms:Decrypt"],
          resources: [key.keyArn],
          conditions: { StringEquals: { "kms:EncryptionContext:userpool-id": userPoolId } },
        }),
      ],
    });
  }
}
