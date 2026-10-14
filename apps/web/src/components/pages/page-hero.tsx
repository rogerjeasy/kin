import Image, { type StaticImageData } from "next/image";

import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { cn } from "@/lib/utils";

type PageHeroProps = {
  eyebrow: string;
  title: string;
  lede: string;
  image?: { src: StaticImageData; alt: string };
};

/** The opening of every page except the homepage. */
export function PageHero({ eyebrow, title, lede, image }: PageHeroProps) {
  return (
    <section className="border-b py-12 sm:py-16 lg:py-24">
      <Container className={cn("grid items-center gap-10 lg:gap-16", image && "lg:grid-cols-2")}>
        <div className="min-w-0">
          <Eyebrow>{eyebrow}</Eyebrow>
          <Heading as="h1" size="display" className="mt-5 max-w-4xl">
            {title}
          </Heading>
          <Lede className="mt-6 max-w-2xl">{lede}</Lede>
        </div>
        {image ? (
          <Image
            src={image.src}
            alt={image.alt}
            priority
            placeholder="blur"
            sizes="(min-width: 1024px) 40rem, 100vw"
            className="aspect-4/3 w-full min-w-0 rounded-3xl object-cover"
          />
        ) : null}
      </Container>
    </section>
  );
}
