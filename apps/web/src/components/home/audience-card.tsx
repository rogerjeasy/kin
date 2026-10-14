import Image, { type StaticImageData } from "next/image";
import type { ReactNode } from "react";

import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { TextLink } from "@/components/shared/text-link";

type AudienceCardProps = {
  eyebrow: string;
  title: string;
  text: string;
  link: { href: string; label: string };
  image?: { src: StaticImageData; alt: string };
  children?: ReactNode;
};

/** A card that introduces one of the other pages and links to it. */
export function AudienceCard({ eyebrow, title, text, link, image, children }: AudienceCardProps) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-3xl border bg-card">
      {image ? (
        <Image src={image.src} alt={image.alt} sizes="(min-width: 768px) 38rem, 100vw" className="aspect-video w-full object-cover object-[50%_30%]" />
      ) : null}
      <div className="flex flex-1 flex-col p-6 sm:p-9">
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
