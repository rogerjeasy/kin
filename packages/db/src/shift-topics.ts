/** The outbox topic that asks the worker to settle a shift whose two keys have turned with no person there to: a check-out by link, the parent's word by phone. Its payload is `{ shiftId }`. */
export const SHIFT_SETTLE_TOPIC = "shift.settle";

/** The outbox topic that asks the worker to phone the parent for the family's word on a shift. Its payload is `{ shiftId }`. */
export const SHIFT_CALL_TOPIC = "shift.call";
