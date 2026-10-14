import { Stack, type StackProps } from "aws-cdk-lib";
import * as budgets from "aws-cdk-lib/aws-budgets";
import * as sns from "aws-cdk-lib/aws-sns";
import * as subscriptions from "aws-cdk-lib/aws-sns-subscriptions";
import type { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { PROJECT_TAG } from "./tags.ts";

/** Percentages of the monthly budget at which an email goes out. */
const BUDGET_WARNINGS = [
  { notificationType: "ACTUAL", threshold: 80 },
  { notificationType: "FORECASTED", threshold: 100 },
] as const;

/**
 * Where Kin tells a person something needs them: a cost budget and a topic for
 * alarms. Deploy this first, so spending is watched before anything costs.
 */
export class OpsStack extends Stack {
  readonly alerts: sns.Topic;

  constructor(scope: Construct, id: string, config: InfraConfig, props: StackProps) {
    super(scope, id, props);

    // Not encrypted with Kin's key: CloudWatch alarms cannot publish to a topic
    // under a customer key without extra grants, and an alarm name is not data.
    this.alerts = new sns.Topic(this, "Alerts", { topicName: "kin-alerts" });
    this.alerts.addSubscription(
      new subscriptions.EmailSubscription(config.alertEmail),
    );

    new budgets.CfnBudget(this, "Budget", {
      budget: {
        budgetName: "kin-monthly",
        budgetType: "COST",
        timeUnit: "MONTHLY",
        budgetLimit: { amount: config.monthlyBudgetUsd, unit: "USD" },
        // Counts only resources tagged project=kin, so the other projects in
        // the account do not set it off. The tag must be activated once as a
        // cost allocation tag in the Billing console.
        filterExpression: {
          tags: { key: PROJECT_TAG.key, values: [PROJECT_TAG.value] },
        },
      },
      notificationsWithSubscribers: BUDGET_WARNINGS.map((warning) => ({
        notification: {
          ...warning,
          comparisonOperator: "GREATER_THAN",
          thresholdType: "PERCENTAGE",
        },
        subscribers: [{ subscriptionType: "EMAIL", address: config.alertEmail }],
      })),
    });
  }
}
