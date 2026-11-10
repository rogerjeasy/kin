import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";

import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { TextLink } from "@/components/shared/text-link";
import { cn } from "@/lib/utils";

type AudienceCardProps = {
  eyebrow: string;
  title: string;
  text: string;
  link: { href: string; label: string };
  image?: { src: StaticImageData; alt: string };
  children?: ReactNode;
};

/**
 * A card that introduces one of the other pages and links to it. With a
 * photograph, the picture fills the whole card and the words sit on a frosted
 * panel at its foot, so the card is full at any height.
 */
export function AudienceCard({ eyebrow, title, text, link, image, children }: AudienceCardProps) {
  return (
    <article
      className={cn(
        "group surface lift glow-edge grid min-w-0 overflow-hidden rounded-3xl",
        image && "min-h-[30rem] grid-cols-1 grid-rows-1 p-2 sm:min-h-[34rem]",
      )}
    >
      {image ? (
        <div className="col-start-1 row-start-1 overflow-hidden rounded-[1.25rem]">
          <Image
            src={image.src}
            alt={image.alt}
            sizes="(min-width: 768px) 38rem, 100vw"
            className="size-full object-cover object-[50%_30%] transition-transform duration-1000 ease-(--ease-out-expo) motion-safe:group-hover:scale-[1.05]"
          />
        </div>
      ) : null}
      <div
        className={cn(
          "flex min-w-0 flex-col",
          image
            ? "col-start-1 row-start-1 m-2 self-end rounded-2xl border bg-card/90 p-5 shadow-lg backdrop-blur-md sm:m-3 sm:p-7"
            : "flex-1 p-6 sm:p-9",
        )}
      >
        <Eyebrow>{eyebrow}</Eyebrow>
        <Heading as="h2" size="subtitle" className="mt-4">
          {title}
        </Heading>
        <p className="mt-3 max-w-md text-muted-foreground">{text}</p>
        {children}
        <TextLink href={link.href} className="mt-auto self-start pt-5">
          {link.label}
        </TextLink>
      </div>
    </article>
  );
}
