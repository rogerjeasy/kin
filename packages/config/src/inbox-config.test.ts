import { describe, expect, it } from "vitest";

import { ConfigError } from "./config-error.ts";
import { readInboxConfig } from "./inbox-config.ts";

const QUEUE = "https://sqs.us-east-1.amazonaws.com/123456789012/kin-paypal-events.fifo";

describe("the PayPal inbox settings", () => {
  it("are absent when no queue is named", () => {
    expect(readInboxConfig({})).toBeNull();
  });

  it("name the queue and the region, with no stand-in in AWS", () => {
    expect(readInboxConfig({ KIN_PAYPAL_INBOX_URL: QUEUE, AWS_REGION: "us-east-1" })).toEqual({ queueUrl: QUEUE, region: "us-east-1", endpoint: null });
  });

  it("insist on a FIFO queue, so one circle's events stay in order", () => {
    expect(() => readInboxConfig({ KIN_PAYPAL_INBOX_URL: QUEUE.replace(".fifo", "") })).toThrow(ConfigError);
  });

  it("accept a stand-in only on this machine", () => {
    const local = "http://localhost:9324/000000000000/kin-paypal-events.fifo";
    expect(readInboxConfig({ KIN_PAYPAL_INBOX_URL: local, KIN_QUEUE_ENDPOINT: "http://localhost:9324" })).toMatchObject({ endpoint: "http://localhost:9324" });
    expect(() => readInboxConfig({ KIN_PAYPAL_INBOX_URL: QUEUE, KIN_QUEUE_ENDPOINT: "https://queue.example.com" })).toThrow(ConfigError);
  });
});
