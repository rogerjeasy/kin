import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { GlowKnot } from "@/components/shared/glow-knot";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { TextLink } from "@/components/shared/text-link";

type NoticePageProps = {
  eyebrow: string;
  title: string;
  text: string;
  link: { href: string; label: string };
};

/** A whole page that says one thing and offers one way onward, in the ink panel by the knot's light. */
export function NoticePage({ eyebrow, title, text, link }: NoticePageProps) {
  const theme = { "data-theme": "dark" };

  return (
    <section {...theme} className="px-2 py-2 sm:px-4 sm:py-4">
      <div className="aurora relative overflow-clip rounded-[1.75rem] text-foreground shadow-xl sm:rounded-[2.5rem]">
        <Container className="grid min-h-[min(44rem,80dvh)] items-center gap-10 py-16 sm:py-20 lg:grid-cols-[minmax(0,1fr)_auto] lg:gap-16">
          <div className="enter-stagger min-w-0">
            <Eyebrow>{eyebrow}</Eyebrow>
            <Heading as="h1" size="display" className="mt-5 max-w-3xl">
              {title}
            </Heading>
            <Lede className="mt-6 max-w-2xl">{text}</Lede>
            <TextLink href={link.href} className="mt-6">
              {link.label}
            </TextLink>
          </div>
          <GlowKnot className="w-40 justify-self-center sm:w-56 lg:w-80" />
        </Container>
      </div>
    </section>
  );
}
