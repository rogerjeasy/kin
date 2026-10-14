import { Container } from "@/components/layout/container";
import { Eyebrow } from "@/components/shared/eyebrow";
import { Heading } from "@/components/shared/heading";
import { Lede } from "@/components/shared/lede";
import { TextLink } from "@/components/shared/text-link";

type NoticePageProps = {
  eyebrow: string;
  title: string;
  text: string;
  link: { href: string; label: string };
};

/** A whole page that says one thing and offers one way onward. */
export function NoticePage({ eyebrow, title, text, link }: NoticePageProps) {
  return (
    <section className="py-20 sm:py-28 lg:py-36">
      <Container>
        <Eyebrow>{eyebrow}</Eyebrow>
        <Heading as="h1" size="display" className="mt-5 max-w-3xl">
          {title}
        </Heading>
        <Lede className="mt-6 max-w-2xl">{text}</Lede>
        <TextLink href={link.href} className="mt-6">
          {link.label}
        </TextLink>
      </Container>
    </section>
  );
}
