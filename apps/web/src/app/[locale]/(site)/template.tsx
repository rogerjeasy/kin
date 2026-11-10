import type { ReactNode } from "react";

/** Each public page fades up into place as it opens (see the dashboard's template). */
export default function SiteTemplate({ children }: { children: ReactNode }) {
  return <div className="enter">{children}</div>;
}
