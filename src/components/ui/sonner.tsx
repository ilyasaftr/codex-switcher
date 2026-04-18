import { CheckCircle2, CircleAlert, LoaderCircle, Info, TriangleAlert, X } from "lucide-react";
import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

type Props = ToasterProps;

export function Toaster(props: Props) {
  return (
    <SonnerToaster
      closeButton
      richColors
      expand={false}
      visibleToasts={5}
      icons={{
        success: <CheckCircle2 className="size-4" />,
        error: <CircleAlert className="size-4" />,
        warning: <TriangleAlert className="size-4" />,
        info: <Info className="size-4" />,
        loading: <LoaderCircle className="size-4 animate-spin" />,
        close: <X className="size-4" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !shadow-[var(--shadow-soft)]",
          title: "!text-sm !font-medium",
          description: "!text-xs !text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}
