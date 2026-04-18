import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.18em]",
  {
    variants: {
      variant: {
        default: "border-border bg-secondary text-secondary-foreground",
        success: "border-emerald-200/70 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        warning: "border-amber-200/70 bg-amber-500/10 text-amber-700 dark:text-amber-300",
        outline: "border-border bg-transparent text-muted-foreground",
        team: "border-sky-200/70 bg-sky-500/10 text-sky-700 dark:text-sky-300",
        destructive: "border-red-200/70 bg-red-500/10 text-red-700 dark:text-red-300",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"div"> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
