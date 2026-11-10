import Image, { type StaticImageData } from "next/image";

import { cn } from "@/lib/utils";

type MomentCardProps = {
  image: StaticImageData;
  alt: string;
  day: string;
  title: string;
  quote: string;
  /** A wide card spans two columns of the grid on a large screen. */
  wide?: boolean;
};

/** One moment of the month: a photograph that leans in on hover, the day, and what was said. */
export function MomentCard({ image, alt, day, title, quote, wide = false }: MomentCardProps) {
  return (
    <li
      className={cn(
        "group surface lift glow-edge flex w-64 shrink-0 snap-start flex-col rounded-3xl p-2 sm:w-72 lg:w-auto",
        wide && "lg:col-span-2",
      )}
    >
      <div className="overflow-hidden rounded-2xl">
        <Image
          src={image}
          alt={alt}
          sizes={wide ? "(min-width: 1024px) 36rem, 18rem" : "18rem"}
          className={cn(
            "aspect-4/3 w-full object-cover transition-transform duration-1000 ease-(--ease-out-expo) motion-safe:group-hover:scale-[1.06]",
            wide && "lg:aspect-[2.1/1]",
          )}
        />
      </div>
      <div className="flex flex-1 flex-col px-3 pt-4 pb-3">
        <p className="inline-flex items-center gap-2 font-mono text-xs font-medium text-highlight uppercase ltr:tracking-widest">
          <span aria-hidden="true" className="size-1.5 rounded-full bg-gold shadow-[0_0_8px_1px_rgb(var(--glow-gold)/0.7)]" />
          {day}
        </p>
        <h3 className="mt-2 text-lg leading-snug font-semibold">{title}</h3>
        <p className="mt-2 border-s-2 border-gold/50 ps-3 font-serif text-lg leading-snug text-muted-foreground ltr:italic">{quote}</p>
      </div>
    </li>
  );
}
