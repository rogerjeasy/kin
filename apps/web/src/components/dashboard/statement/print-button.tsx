"use client";

import { PrinterIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

/** Opens the browser's print dialog, which also saves the page as a PDF. */
export function PrintButton({ label }: { label: string }) {
  return (
    <Button type="button" variant="outline" size="sm" className="min-h-11 w-full sm:w-auto print:hidden" onClick={() => window.print()}>
      <PrinterIcon aria-hidden="true" />
      {label}
    </Button>
  );
}
