import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { InboxConfig } from "@kin/config";

import { encodeInboxMessage, inboxDeduplicationId, inboxGroup, parseInboxMessage, type InboxMessage } from "./inbox.ts";

/** A message taken off the queue, with the handle that removes it once handled. */
export type Received = { readonly message: InboxMessage | null; readonly receipt: string };

export type Inbox = {
  readonly send: (message: InboxMessage) => Promise<void>;
  /** Waits up to 20 seconds for messages; an empty answer costs one request. */
  readonly receive: () => Promise<readonly Received[]>;
  readonly remove: (receipt: string) => Promise<void>;
};

const WAIT_SECONDS = 20;
const BATCH = 10;

/**
 * The PayPal inbox on SQS, or on a stand-in on this machine. Long polling
 * means an idle worker makes three requests a minute and never touches the
 * database, so Aurora can pause (docs/architecture.md decision 43).
 */
export function sqsInbox(config: InboxConfig): Inbox {
  const sqs = new SQSClient({
    region: config.region,
    ...(config.endpoint === null ? {} : { endpoint: config.endpoint, credentials: { accessKeyId: "local", secretAccessKey: "local" } }),
  });
  return {
    async send(message) {
      await sqs.send(
        new SendMessageCommand({
          QueueUrl: config.queueUrl,
          MessageBody: encodeInboxMessage(message),
          MessageGroupId: inboxGroup(message),
          MessageDeduplicationId: inboxDeduplicationId(message),
        }),
      );
    },
    async receive() {
      const answer = await sqs.send(new ReceiveMessageCommand({ QueueUrl: config.queueUrl, MaxNumberOfMessages: BATCH, WaitTimeSeconds: WAIT_SECONDS }));
      return (answer.Messages ?? []).flatMap((each) =>
        each.ReceiptHandle === undefined ? [] : [{ message: parseInboxMessage(each.Body ?? ""), receipt: each.ReceiptHandle }],
      );
    },
    async remove(receipt) {
      await sqs.send(new DeleteMessageCommand({ QueueUrl: config.queueUrl, ReceiptHandle: receipt }));
    },
  };
}
