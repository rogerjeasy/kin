import { E164 } from "./mask-number.ts";
import { OutboundCallError, type OutboundCaller, type PlaceCallRequest, type PlacedCall } from "./outbound-caller.ts";

/** The fake adapter of the outbound call interface: it records each call and rings nobody. */
export type FakeOutboundCaller = OutboundCaller & {
  /** Every call placed, in order. */
  readonly placed: readonly PlaceCallRequest[];
  /** Makes the next `placeCall` fail with this error, once. */
  failNext(error: OutboundCallError): void;
};

export function fakeOutboundCaller(): FakeOutboundCaller {
  const placed: PlaceCallRequest[] = [];
  let failure: OutboundCallError | null = null;
  return {
    placed,
    failNext(error) {
      failure = error;
    },
    placeCall(request): Promise<PlacedCall> {
      if (failure !== null) {
        const error = failure;
        failure = null;
        return Promise.reject(error);
      }
      if (!E164.test(request.to)) return Promise.reject(new OutboundCallError("bad_number", { retryable: false, mayHaveBeenPlaced: false }));
      placed.push(request);
      const callSid = `CA${placed.length.toString(16).padStart(32, "0")}`;
      return Promise.resolve({ callSid, status: "queued" });
    },
  };
}
