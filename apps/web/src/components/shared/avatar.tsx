import Image, { type StaticImageData } from "next/image";

import { cn } from "@/lib/utils";

const sizes = {
  sm: { box: "size-9", hint: "2.25rem" },
  md: { box: "size-11", hint: "2.75rem" },
  lg: { box: "size-14", hint: "3.5rem" },
} as const;

type AvatarProps = {
  src: StaticImageData;
  size?: keyof typeof sizes;
  className?: string;
};

/** A round portrait. Decorative: the person's name is always written beside it. */
export function Avatar({ src, size = "md", className }: AvatarProps) {
  return (
    <Image
      src={src}
      alt=""
      sizes={sizes[size].hint}
      className={cn("shrink-0 rounded-full object-cover", sizes[size].box, className)}
    />
  );
}
