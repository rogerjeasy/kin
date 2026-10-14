import { faviconSvg } from "@/components/brand/favicon";

export const contentType = "image/svg+xml";

/** The site icon, drawn from the same geometry as the logo. */
export default function Icon(): Response {
  return new Response(faviconSvg(), { headers: { "Content-Type": contentType } });
}
