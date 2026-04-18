import { Slot } from "@radix-ui/react-slot";

import { cn } from "@/lib/utils";

const panelActionButtonClassName =
  "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-card text-foreground shadow-[var(--shadow-soft)] transition-all outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4";

interface PanelActionButtonProps extends React.ComponentProps<"button"> {
  asChild?: boolean;
}

function PanelActionButton({
  className,
  asChild = false,
  ...props
}: PanelActionButtonProps) {
  const Comp = asChild ? Slot : "button";

  return <Comp className={cn(panelActionButtonClassName, className)} {...props} />;
}

export { PanelActionButton, panelActionButtonClassName };
