import Image from "next/image";

import caregiverVisit from "@/assets/images/caregiver-visit.jpg";
import { PaymentTicker } from "@/components/shared/payment-ticker";

type CaregiverPhotoProps = {
  alt: string;
  /** The example payment shown with the photograph. */
  payment: { text: string; note: string; tag: string };
};

/**
 * Amara with Rose, and the payment that followed the visit. From sm up the
 * payment sits over the foot of the photograph, stacked in one grid cell. On a
 * phone it drops below, so it never covers their faces.
 */
export function CaregiverPhoto({ alt, payment }: CaregiverPhotoProps) {
  return (
    <div className="grid grid-cols-1">
      <div className="col-start-1 row-start-1 rounded-[1.75rem] border border-foreground/10 bg-foreground/[0.04] p-1.5 shadow-xl">
        <Image
          src={caregiverVisit}
          alt={alt}
          priority
          placeholder="blur"
          sizes="(min-width: 1024px) 40rem, 100vw"
          className="aspect-4/3 w-full rounded-3xl object-cover sm:aspect-5/4"
        />
      </div>
      <PaymentTicker
        {...payment}
        className="col-start-1 row-start-2 mt-3 sm:row-start-1 sm:m-5 sm:mt-0 sm:self-end motion-safe:sm:animate-float"
      />
    </div>
  );
}
