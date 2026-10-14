import { notFound } from "next/navigation";

// Any address under a language that no page claims. Raising notFound here
// makes Next render not-found.tsx inside the language's layout, with a 404.
export default function UnknownPage() {
  notFound();
}
