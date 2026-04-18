import { Copy, Download, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";

interface TransferDialogProps {
  open: boolean;
  mode: "slim_export" | "slim_import";
  payload: string;
  error: string | null;
  copied: boolean;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onPayloadChange: (value: string) => void;
  onCopy: () => void;
  onSubmit: () => void;
}

export function TransferDialog({
  open,
  mode,
  payload,
  error,
  copied,
  busy,
  onOpenChange,
  onPayloadChange,
  onCopy,
  onSubmit,
}: TransferDialogProps) {
  const isExport = mode === "slim_export";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{isExport ? "Export Slim Text" : "Import Slim Text"}</DialogTitle>
          <DialogDescription>
            {isExport
              ? "Share a compact account payload without using the encrypted full backup format."
              : "Paste a slim text payload to import ChatGPT account credentials into this workspace."}
          </DialogDescription>
        </DialogHeader>

        <Textarea
          value={payload}
          onChange={(event) => onPayloadChange(event.target.value)}
          readOnly={isExport}
          className="min-h-[260px] font-mono text-xs"
          placeholder={
            isExport
              ? "Preparing slim export..."
              : "Paste the slim text payload here"
          }
        />

        {error ? (
          <div className="rounded-xl border border-red-200/70 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>

          {isExport ? (
            <Button variant="outline" onClick={onCopy} disabled={!payload || busy}>
              <Copy />
              {copied ? "Copied" : "Copy Payload"}
            </Button>
          ) : (
            <Button onClick={onSubmit} disabled={busy || !payload.trim()}>
              {busy ? <Upload className="animate-pulse" /> : <Upload />}
              Import Payload
            </Button>
          )}

          {isExport ? (
            <Button onClick={onSubmit} disabled={busy}>
              {busy ? <Download className="animate-pulse" /> : <Download />}
              Refresh Export
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
