import { ACCOUNT_TYPES } from "@kin/auth";
import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cognito from "aws-cdk-lib/aws-cognito";
import type * as kms from "aws-cdk-lib/aws-kms";
import { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { SignInEmailSender, createGmailSecret } from "./sign-in-email.ts";

const MIN_PASSWORD_LENGTH = 12;

/**
 * Kin's own user pool, docs/tech-stack.md section 9. Nobody from another
 * project in the account signs in here, and nobody from Kin signs in there.
 * Cognito answers who a person is. Kin's database answers what they may do.
 */
export class Identity extends Construct {
  readonly userPool: cognito.UserPool;
  readonly webClient: cognito.UserPoolClient;
  readonly domain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, config: InfraConfig, key: kms.IKey) {
    super(scope, id);

    const gmailSecret = createGmailSecret(this, config, key);
    const sender =
      config.senderEmail === null
        ? null
        : new SignInEmailSender(this, "SignInEmail", { senderEmail: config.senderEmail, secret: gmailSecret, key });
    this.userPool = new cognito.UserPool(this, "People", {
      userPoolName: "kin-people",
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      signInCaseSensitive: false,
      autoVerify: { email: true },
      standardAttributes: {
        email: { required: true, mutable: true },
        fullname: { required: true, mutable: true },
      },
      passwordPolicy: {
        minLength: MIN_PASSWORD_LENGTH,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      // Approving a payout asks for a fresh second factor, so every person
      // can enrol an authenticator app.
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      // A code by email is the sign-in the product describes (tech-stack
      // section 9.1). Cognito emails codes only through SES or a custom
      // sender, so it is on only once Kin's Gmail sender is configured.
      // A password stays possible either way.
      ...(sender === null
        ? {}
        : {
            customSenderKmsKey: key,
            lambdaTriggers: { customEmailSender: sender.function },
            signInPolicy: { allowedFirstAuthFactors: { password: true, emailOtp: true } },
          }),
      userVerification: {
        emailSubject: "Your Kin code",
        emailBody: "Your Kin code is {####}. If you did not ask for it, you can ignore this email.",
        emailStyle: cognito.VerificationEmailStyle.CODE,
      },
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    sender?.allowCodesOf(this.userPool.userPoolId, key);

    for (const accountType of ACCOUNT_TYPES) {
      new cognito.CfnUserPoolGroup(this, `group-${accountType}`, {
        userPoolId: this.userPool.userPoolId,
        groupName: accountType,
      });
    }

    this.domain = this.userPool.addDomain("Domain", {
      cognitoDomain: { domainPrefix: `kin-${config.account}` },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.webClient = this.userPool.addClient("Web", {
      userPoolClientName: "kin-web",
      // A public client with PKCE: no client secret to store or leak.
      generateSecret: false,
      // USER_AUTH is the choice-based flow that offers the code by email.
      authFlows: { userSrp: true, user: sender !== null },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: config.webOrigins.map((origin) => `${origin}/auth/callback`),
        logoutUrls: config.webOrigins.map((origin) => `${origin}/`),
      },
      preventUserExistenceErrors: true,
      accessTokenValidity: Duration.minutes(60),
      idTokenValidity: Duration.minutes(60),
      refreshTokenValidity: Duration.days(7),
    });

    // Managed login shows a page only to a client that has a style.
    new cognito.CfnManagedLoginBranding(this, "Branding", {
      userPoolId: this.userPool.userPoolId,
      clientId: this.webClient.userPoolClientId,
      useCognitoProvidedValues: true,
    });
  }
}
