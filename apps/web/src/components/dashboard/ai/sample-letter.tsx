"use client";

import { CameraIcon } from "lucide-react";
import Image from "next/image";
import { useState } from "react";

import sample from "@/content/demo/sample-letter.png";
import { Button } from "@/components/ui/button";
import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  copy: Dictionary["aiProvenance"]["sample"];
  disabled: boolean;
  /** Given the sample as a picture file, to be read through the same route as any photograph. */
  onPick: (photo: File) => void;
};

/**
 * A made-up letter, ready to be read, for a visitor with no camera or letter
 * to hand. It is sent like any photograph the person chose: the server's
 * checks of type and size are the same, and nothing here reads it.
 */
export function SampleLetter({ copy, disabled, onPick }: Props) {
  const [failed, setFailed] = useState(false);
  async function pick() {
    setFailed(false);
    try {
      const response = await fetch(sample.src);
      if (!response.ok) throw new Error("The sample letter could not be loaded");
      onPick(new File([await response.blob()], "sample-letter.png", { type: "image/png" }));
    } catch {
      setFailed(true);
    }
  }
  return (
    <div className="flex min-w-0 flex-wrap items-start gap-4 rounded-2xl border border-dashed p-4">
      <Image src={sample} alt={copy.imageAlt} sizes="(min-width: 640px) 8rem, 6rem" className="h-auto w-24 shrink-0 rounded-lg border sm:w-32" />
      <div className="min-w-0 flex-1 basis-48 space-y-2">
        <p className="font-medium">{copy.title}</p>
        <p className="text-sm text-muted-foreground">{copy.text}</p>
        <Button type="button" variant="outline" disabled={disabled} className="h-auto min-h-11 max-w-full shrink whitespace-normal text-start" onClick={pick}>
          <CameraIcon aria-hidden="true" />
          {copy.button}
        </Button>
        {failed ? <p role="alert" className="text-sm text-danger">{copy.failed}</p> : null}
      </div>
    </div>
  );
}
