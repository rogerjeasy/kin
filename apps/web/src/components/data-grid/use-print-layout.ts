"use client";

import { useEffect, useState } from "react";

const QUERY = "print";

/**
 * True while the page is being printed or saved as a PDF. A grid draws only
 * the rows and columns in view, so for print it must lay out all of them.
 */
export function usePrintLayout(): boolean {
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(QUERY);
    const update = () => setPrinting(query.matches);
    const start = () => setPrinting(true);
    const end = () => setPrinting(query.matches);
    query.addEventListener("change", update);
    window.addEventListener("beforeprint", start);
    window.addEventListener("afterprint", end);
    update();
    return () => {
      query.removeEventListener("change", update);
      window.removeEventListener("beforeprint", start);
      window.removeEventListener("afterprint", end);
    };
  }, []);

  return printing;
}
