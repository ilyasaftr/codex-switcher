import type { ReactNode } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface PanelShellProps {
  icon: ReactNode;
  title: string;
  action?: ReactNode;
  reserveActionSlot?: boolean;
  children: ReactNode;
  className?: string;
  contentClassName?: string;
}

export function PanelShell({
  icon,
  title,
  action,
  reserveActionSlot = true,
  children,
  className,
  contentClassName,
}: PanelShellProps) {
  return (
    <Card className={cn("overflow-hidden border-border/70 bg-card/96", className)}>
      <CardHeader className="space-y-4 p-5 pb-4">
        <div className="grid grid-cols-[1rem_minmax(0,1fr)_2.5rem] items-center gap-3">
          <div className="flex h-4 w-4 items-center justify-center text-muted-foreground">
            {icon}
          </div>
          <CardTitle className="text-xl font-semibold tracking-tight">{title}</CardTitle>
          {action ? (
            <div className="flex h-10 w-10 items-center justify-center">{action}</div>
          ) : reserveActionSlot ? (
            <div className="h-10 w-10" aria-hidden="true" />
          ) : null}
        </div>
        <div className="border-b" />
      </CardHeader>
      <CardContent className={cn("p-5 pt-0", contentClassName)}>{children}</CardContent>
    </Card>
  );
}
