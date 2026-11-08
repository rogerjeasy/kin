import { TextDeliveryError, isE164, type SentText, type TextMessage, type TextSender } from "./text-sender.ts";

/** The fake adapter of the text interface: it records each message and sends nothing. */
export type FakeTextSender = TextSender & {
  /** Every message sent, in order. */
  readonly sent: readonly TextMessage[];
  /** Makes the next `send` fail with this error, once. */
  failNext(error: TextDeliveryError): void;
};

export function fakeTextSender(): FakeTextSender {
  const sent: TextMessage[] = [];
  let failure: TextDeliveryError | null = null;
  return {
    sent,
    failNext(error) {
      failure = error;
    },
    send(message): Promise<SentText> {
      if (failure !== null) {
        const error = failure;
        failure = null;
        return Promise.reject(error);
      }
      if (!isE164(message.to)) return Promise.reject(new TextDeliveryError("bad_number", { retryable: false, mayHaveBeenSent: false }));
      sent.push(message);
      return Promise.resolve({ messageSid: `SM${sent.length.toString(16).padStart(32, "0")}` });
    },
  };
}
