import caregiverVisit from "@/assets/images/caregiver-visit.jpg";
import momentBill from "@/assets/images/moment-bill.jpg";
import momentCall from "@/assets/images/moment-call.jpg";
import momentLetter from "@/assets/images/moment-letter.jpg";
import momentRefill from "@/assets/images/moment-refill.jpg";
import momentSettled from "@/assets/images/moment-settled.jpg";

/** One photograph for each moment of the month that has one. */
export const momentImages = {
  bill: momentBill,
  caregiver: caregiverVisit,
  refill: momentRefill,
  letter: momentLetter,
  call: momentCall,
  settled: momentSettled,
} as const;

export type Moment = keyof typeof momentImages;
