import Image, { type StaticImageData } from "next/image";

type MomentCardProps = {
  image: StaticImageData;
  alt: string;
  day: string;
  title: string;
  quote: string;
};

/** One moment of the month: a photograph, the day, and what was said. */
export function MomentCard({ image, alt, day, title, quote }: MomentCardProps) {
  return (
    <li className="w-60 shrink-0 snap-start">
      <Image src={image} alt={alt} sizes="15rem" className="aspect-4/3 w-full rounded-xl object-cover" />
      <p className="mt-3.5 font-mono text-xs font-medium text-highlight uppercase ltr:tracking-widest">{day}</p>
      <h3 className="mt-1.5 text-lg leading-snug font-semibold">{title}</h3>
      <p className="mt-1.5 font-serif text-lg leading-snug text-muted-foreground ltr:italic">{quote}</p>
    </li>
  );
}
