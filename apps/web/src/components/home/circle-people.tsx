import Image from "next/image";

import amara from "@/assets/images/amara.jpg";
import ana from "@/assets/images/ana.jpg";
import elena from "@/assets/images/elena.jpg";
import marcus from "@/assets/images/marcus.jpg";

type CirclePeopleProps = { names: string; note: string };

const faces = [elena, marcus, ana, amara];

/** The four people around Rose, as a row of small portraits. */
export function CirclePeople({ names, note }: CirclePeopleProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 border-t pt-6">
      <div className="flex ps-2.5" aria-hidden="true">
        {faces.map((face) => (
          <Image
            key={face.src}
            src={face}
            alt=""
            sizes="2.75rem"
            className="-ms-2.5 size-11 rounded-full border-2 border-background object-cover"
          />
        ))}
      </div>
      <p className="min-w-0 text-[0.9375rem]">
        {names}
        <span className="block text-sm text-muted-foreground">{note}</span>
      </p>
    </div>
  );
}
