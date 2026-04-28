import { useRef, useState } from "react";
import { Copy, ExternalLink, FileJson2, Globe, LoaderCircle } from "lucide-react";

import {
  describeFileSource,
  isTauriRuntime,
  openExternalUrl,
  pickAuthJsonFile,
  type FileSource,
} from "@/lib/platform";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { OAuthLoginInfo } from "@/types";

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFile: (source: FileSource) => Promise<void>;
  onStartOAuth: () => Promise<OAuthLoginInfo>;
  onCompleteOAuth: (flowId: string) => Promise<unknown>;
  onCancelOAuth: (flowId: string) => Promise<void>;
  onCancelAllOAuth: () => Promise<void>;
}

type Tab = "oauth" | "import";
type OAuthFlowStatus = "waiting" | "completing" | "completed" | "failed" | "canceled" | "timed_out";

interface OAuthFlowRow extends OAuthLoginInfo {
  status: OAuthFlowStatus;
  error?: string | null;
}

export function AddAccountModal({
  isOpen,
  onClose,
  onImportFile,
  onStartOAuth,
  onCompleteOAuth,
  onCancelOAuth,
  onCancelAllOAuth,
}: AddAccountModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("oauth");
  const [fileSource, setFileSource] = useState<FileSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthFlows, setOauthFlows] = useState<OAuthFlowRow[]>([]);
  const [copiedFlowId, setCopiedFlowId] = useState<string | null>(null);
  const copyTimerRef = useRef<number | null>(null);
  const removeTimersRef = useRef<Map<string, number>>(new Map());
  const tauriRuntime = isTauriRuntime();

  const clearCopyTimer = () => {
    if (copyTimerRef.current === null) return;
    window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
  };

  const clearRemoveTimers = () => {
    removeTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    removeTimersRef.current.clear();
  };

  const resetForm = () => {
    clearCopyTimer();
    clearRemoveTimers();
    setFileSource(null);
    setError(null);
    setLoading(false);
    setOauthFlows([]);
    setCopiedFlowId(null);
  };

  const hasActiveOAuthFlow =
    activeTab === "oauth" &&
    (loading || oauthFlows.some((flow) => flow.status === "waiting" || flow.status === "completing"));

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (hasActiveOAuthFlow) {
      void onCancelAllOAuth();
    }
    resetForm();
    onClose();
  };

  const scheduleFlowRemoval = (flowId: string, onRemoved?: () => void) => {
    const existingTimer = removeTimersRef.current.get(flowId);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const timer = window.setTimeout(() => {
      removeTimersRef.current.delete(flowId);
      setOauthFlows((current) => current.filter((flow) => flow.flow_id !== flowId));
      onRemoved?.();
    }, 1200);

    removeTimersRef.current.set(flowId, timer);
  };

  const maybeCloseAfterCompletion = (flowId: string) => {
    setOauthFlows((current) => {
      const remainingActive = current.some(
        (flow) =>
          flow.flow_id !== flowId && (flow.status === "waiting" || flow.status === "completing")
      );
      if (!remainingActive) {
        scheduleFlowRemoval(flowId, () => {
          resetForm();
          onClose();
        });
      }
      return current;
    });
  };

  const completeOAuthFlow = async (flowId: string) => {
    try {
      setOauthFlows((current) =>
        current.map((flow) =>
          flow.flow_id === flowId ? { ...flow, status: "completing", error: null } : flow
        )
      );
      await onCompleteOAuth(flowId);
      setOauthFlows((current) =>
        current.map((flow) =>
          flow.flow_id === flowId ? { ...flow, status: "completed", error: null } : flow
        )
      );
      maybeCloseAfterCompletion(flowId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const normalizedMessage = message.toLowerCase();
      const status: OAuthFlowStatus =
        normalizedMessage.includes("cancelled") || normalizedMessage.includes("canceled")
          ? "canceled"
          : normalizedMessage.includes("timed out")
            ? "timed_out"
            : "failed";
      setOauthFlows((current) =>
        current.map((flow) =>
          flow.flow_id === flowId
            ? { ...flow, status, error: status === "canceled" ? null : message }
            : flow
        )
      );
    }
  };

  const handleOAuthLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      setCopiedFlowId(null);
      const info = await onStartOAuth();
      setOauthFlows((current) => [
        ...current,
        {
          ...info,
          status: "waiting",
          error: null,
        },
      ]);
      setLoading(false);
      void completeOAuthFlow(info.flow_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const handleSelectFile = async () => {
    try {
      const selected = await pickAuthJsonFile();
      if (selected) setFileSource(selected);
    } catch (err) {
      console.error("Failed to open file dialog:", err);
    }
  };

  const handleImportFile = async () => {
    if (!fileSource) {
      setError("Select an auth.json file first.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      await onImportFile(fileSource);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    }
  };

  const switchTab = (tab: Tab) => {
    if (tab === activeTab) return;

    if (hasActiveOAuthFlow) {
      void onCancelAllOAuth().catch((err) => console.error("Failed to cancel logins:", err));
      setLoading(false);
      setOauthFlows([]);
      setCopiedFlowId(null);
    }
    setError(null);
    setActiveTab(tab);
  };

  const handleCopyAuthUrl = (flow: OAuthFlowRow) => {
    setError(null);
    clearCopyTimer();
    void navigator.clipboard
      .writeText(flow.auth_url)
      .then(() => {
        setCopiedFlowId(flow.flow_id);
        copyTimerRef.current = window.setTimeout(() => {
          setCopiedFlowId(null);
          copyTimerRef.current = null;
        }, 1500);
      })
      .catch(() => setError("Clipboard unavailable. Copy the URL manually."));
  };

  const handleOpenAuthUrl = (flow: OAuthFlowRow) => {
    setError(null);
    void openExternalUrl(flow.auth_url).catch((err) =>
      setError(err instanceof Error ? err.message : String(err))
    );
  };

  const handleCancelOAuthFlow = (flowId: string) => {
    setOauthFlows((current) =>
      current.map((flow) =>
        flow.flow_id === flowId ? { ...flow, status: "canceled", error: null } : flow
      )
    );
    void onCancelOAuth(flowId);
    scheduleFlowRemoval(flowId);
  };

  const getFlowStatusLabel = (status: OAuthFlowStatus) => {
    switch (status) {
      case "waiting":
      case "completing":
        return "Waiting";
      case "completed":
        return "Completed";
      case "failed":
        return "Failed";
      case "canceled":
        return "Canceled";
      case "timed_out":
        return "Timed out";
    }
  };

  const methodCardClass = (tab: Tab) =>
    cn(
      "group flex h-full flex-col items-start gap-2.5 rounded-2xl border px-4 py-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60",
      activeTab === tab
        ? "border-border bg-card text-foreground"
        : "border-border/60 bg-background text-muted-foreground hover:border-border hover:text-foreground"
    );

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="grid max-h-[calc(100dvh-2rem)] max-w-2xl grid-rows-[minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 [&>button]:right-4 [&>button]:top-4 [&>button]:rounded-full [&>button]:border [&>button]:border-transparent [&>button]:bg-background/70 [&>button]:p-1.5 [&>button]:text-muted-foreground [&>button]:hover:bg-muted/70 [&>button]:hover:text-foreground sm:[&>button]:right-5 sm:[&>button]:top-5">
        <div className="min-h-0 overflow-y-auto px-5 pb-4 pt-6 sm:px-6 sm:pb-5 sm:pt-6">
        <DialogHeader className="gap-2 pr-10">
          <DialogTitle className="text-[1.75rem] leading-none sm:text-[2rem]">
            Add Account
          </DialogTitle>
          <DialogDescription>
            Choose how you want to add this account.
          </DialogDescription>
        </DialogHeader>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => switchTab("oauth")}
            className={methodCardClass("oauth")}
          >
            <div
              className={cn(
                "rounded-full border p-2 transition-colors",
                activeTab === "oauth"
                  ? "border-border bg-muted/35"
                  : "border-border/60 bg-background"
              )}
            >
              <Globe className="size-4" />
            </div>
            <div className="space-y-1">
              <div className="text-base font-semibold text-foreground">Browser Login</div>
              <div className="text-sm text-muted-foreground">
                Sign in through the browser.
              </div>
            </div>
          </button>
          <button
            type="button"
            onClick={() => switchTab("import")}
            className={methodCardClass("import")}
          >
            <div
              className={cn(
                "rounded-full border p-2 transition-colors",
                activeTab === "import"
                  ? "border-border bg-muted/35"
                  : "border-border/60 bg-background"
              )}
            >
              <FileJson2 className="size-4" />
            </div>
            <div className="space-y-1">
              <div className="text-base font-semibold text-foreground">Import `auth.json`</div>
              <div className="text-sm text-muted-foreground">
                Use an existing session file.
              </div>
            </div>
          </button>
        </div>

        {activeTab === "oauth" ? (
          <div className="mt-5 rounded-2xl border border-border/70 bg-muted/14 p-4 sm:p-5">
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="rounded-full border border-border/70 bg-background/80 p-2">
                  {hasActiveOAuthFlow ? (
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  ) : (
                    <Globe className="size-4 text-muted-foreground" />
                  )}
                </div>
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p>Generate secure login links and finish sign-in in your browser.</p>
                  <p>Email and account metadata are pulled automatically after each login.</p>
                </div>
              </div>

              {oauthFlows.length > 0 ? (
                <div className="space-y-3">
                  {oauthFlows.map((flow, index) => {
                    const isActive =
                      flow.status === "waiting" || flow.status === "completing";
                    return (
                      <div
                        key={flow.flow_id}
                        className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            Login URL {index + 1}
                          </div>
                          <div
                            className={cn(
                              "rounded-full border px-2 py-0.5 text-xs font-medium",
                              flow.status === "failed" || flow.status === "timed_out"
                                ? "border-destructive/35 bg-destructive/10 text-destructive"
                                : "border-border/70 bg-muted/35 text-muted-foreground"
                            )}
                          >
                            {getFlowStatusLabel(flow.status)}
                          </div>
                        </div>
                        <Input
                          readOnly
                          value={flow.auth_url}
                          title={flow.auth_url}
                          className="min-w-0 overflow-x-auto font-mono text-xs"
                        />
                        <div className="grid gap-2 sm:flex sm:flex-wrap">
                          <Button
                            size="sm"
                            onClick={() => handleOpenAuthUrl(flow)}
                            disabled={!isActive}
                          >
                            <ExternalLink />
                            Open
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyAuthUrl(flow)}
                          >
                            <Copy />
                            {copiedFlowId === flow.flow_id ? "Copied" : "Copy"}
                          </Button>
                          {isActive ? (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCancelOAuthFlow(flow.flow_id)}
                            >
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                        {flow.error ? (
                          <div className="rounded-lg border border-destructive/35 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                            {flow.error}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {!tauriRuntime ? (
                <p className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/70 dark:text-amber-300">
                  The callback uses `localhost`, so each browser flow must complete on the same host.
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-5 rounded-2xl border border-border/70 bg-muted/14 p-4 sm:p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full border border-border/70 bg-background/80 p-2">
                <FileJson2 className="size-4 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-4">
                <div className="text-sm text-muted-foreground">
                  Choose a Codex `auth.json` file to import this account.
                </div>
                <div className="grid gap-2 sm:flex">
                  <Input readOnly value={describeFileSource(fileSource)} className="flex-1" />
                  <Button variant="outline" onClick={() => void handleSelectFile()}>
                    Browse
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error ? (
          <div className="mt-4 rounded-xl border border-destructive/35 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        </div>

        <DialogFooter className="border-t border-border/70 bg-background/95 px-5 py-4 sm:px-6">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {hasActiveOAuthFlow ? "Close & Cancel Logins" : "Cancel"}
          </Button>
          <Button
            onClick={() => void (activeTab === "oauth" ? handleOAuthLogin() : handleImportFile())}
            disabled={loading}
          >
            {loading ? <LoaderCircle className="animate-spin" /> : null}
            {loading
              ? "Processing"
              : activeTab === "oauth"
                ? "Generate Login Link"
                : "Import Account"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
