import { Duration, RemovalPolicy } from "aws-cdk-lib";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as actions from "aws-cdk-lib/aws-cloudwatch-actions";
import type * as kms from "aws-cdk-lib/aws-kms";
import type * as sns from "aws-cdk-lib/aws-sns";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { Construct } from "constructs";

import type { InfraConfig } from "./config.ts";
import { denyNeighbours } from "./isolation.ts";

/**
 * The queues of docs/architecture.md section 14.5. An ordered queue is FIFO:
 * producers set the message group to the circle (or, for narration, the
 * parent), so two workers never act on the same circle at once.
 */
export const QUEUES = {
  // Longer than the worker's slowest message: up to 90 seconds waiting for a
  // paused Aurora (decision 43), then up to three PayPal calls of three tries
  // each. A message is not handed out twice meanwhile.
  "paypal-events": { ordered: true, visibilityTimeout: Duration.seconds(300) },
  executions: { ordered: true, visibilityTimeout: Duration.seconds(120) },
  documents: { ordered: false, visibilityTimeout: Duration.minutes(5) },
  notifications: { ordered: false, visibilityTimeout: Duration.seconds(60) },
  narration: { ordered: true, visibilityTimeout: Duration.seconds(60) },
} as const;

export type QueueName = keyof typeof QUEUES;

/** A message that fails this many times moves to the dead-letter queue. */
const MAX_RECEIVES = 5;

type QueuesProps = {
  readonly config: InfraConfig;
  readonly key: kms.IKey;
  readonly alerts: sns.ITopic;
};

export class Queues extends Construct {
  readonly byName: Readonly<Record<QueueName, sqs.Queue>>;

  constructor(scope: Construct, id: string, props: QueuesProps) {
    super(scope, id);
    const entries = Object.entries(QUEUES) as [
      QueueName,
      (typeof QUEUES)[QueueName],
    ][];
    this.byName = Object.fromEntries(
      entries.map(([name, settings]) => [
        name,
        this.createQueue(name, settings, props),
      ]),
    ) as Record<QueueName, sqs.Queue>;
  }

  private createQueue(
    name: QueueName,
    settings: (typeof QUEUES)[QueueName],
    { config, key, alerts }: QueuesProps,
  ): sqs.Queue {
    const suffix = settings.ordered ? ".fifo" : "";
    const shared = {
      fifo: settings.ordered ? true : undefined,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: key,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.RETAIN,
    };
    const deadLetters = new sqs.Queue(this, `${name}-dlq`, {
      ...shared,
      queueName: `kin-${name}-dlq${suffix}`,
      retentionPeriod: Duration.days(14),
    });
    const queue = new sqs.Queue(this, name, {
      ...shared,
      queueName: `kin-${name}${suffix}`,
      visibilityTimeout: settings.visibilityTimeout,
      retentionPeriod: Duration.days(4),
      deadLetterQueue: { queue: deadLetters, maxReceiveCount: MAX_RECEIVES },
    });
    for (const each of [queue, deadLetters]) {
      each.addToResourcePolicy(
        denyNeighbours(this, config, ["sqs:*"], [each.queueArn]),
      );
    }

    new cloudwatch.Alarm(this, `${name}-dlq-alarm`, {
      alarmName: `kin-${name}-dead-letters`,
      alarmDescription: `A message on ${name} failed ${MAX_RECEIVES} times and needs a person`,
      metric: deadLetters.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(1),
      }),
      threshold: 0,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    }).addAlarmAction(new actions.SnsAction(alerts));
    return queue;
  }
}
