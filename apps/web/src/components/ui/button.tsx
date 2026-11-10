import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// Every size is at least 44 by 44 CSS pixels, the minimum touch target.
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap transition-[background-color,color,box-shadow,transform] duration-300 ease-(--ease-out-expo) active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default:
          "shine bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-sm)] hover:shadow-[inset_0_1px_0_rgb(255_255_255/0.14),var(--shadow-glow)]",
        inverse:
          "shine bg-band-foreground text-band outline-band-foreground shadow-[0_10px_40px_-12px_rgb(var(--glow-gold)/0.6)] hover:shadow-[0_0_0_4px_rgb(var(--glow-gold)/0.18),0_14px_48px_-10px_rgb(var(--glow-gold)/0.75)]",
        outline:
          "border border-input bg-card font-medium text-foreground shadow-2xs hover:border-foreground/30 hover:bg-accent hover:shadow-sm",
        ghost: "font-medium text-muted-foreground hover:bg-accent hover:text-foreground",
      },
      size: {
        default: "min-h-12 px-6 text-base",
        sm: "min-h-11 px-4 text-[0.9375rem]",
        icon: "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
