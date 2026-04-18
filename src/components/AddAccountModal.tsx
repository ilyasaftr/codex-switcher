import { useState } from "react";
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

interface AddAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFile: (source: FileSource) => Promise<void>;
  onStartOAuth: () => Promise<{ auth_url: string }>;
  onCompleteOAuth: () => Promise<unknown>;
  onCancelOAuth: () => Promise<void>;
}

type Tab = "oauth" | "import";

export function AddAccountModal({
  isOpen,
  onClose,
  onImportFile,
  onStartOAuth,
  onCompleteOAuth,
  onCancelOAuth,
}: AddAccountModalProps) {
  const [activeTab, setActiveTab] = useState<Tab>("oauth");
  const [fileSource, setFileSource] = useState<FileSource | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [oauthPending, setOauthPending] = useState(false);
  const [authUrl, setAuthUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const tauriRuntime = isTauriRuntime();

  const resetForm = () => {
    setFileSource(null);
    setError(null);
    setLoading(false);
    setOauthPending(false);
    setAuthUrl("");
    setCopied(false);
  };

  const handleOpenChange = (open: boolean) => {
    if (open) return;
    if (oauthPending) {
      void onCancelOAuth();
    }
    resetForm();
    onClose();
  };

  const handleOAuthLogin = async () => {
    try {
      setLoading(true);
      setError(null);
      const info = await onStartOAuth();
      setAuthUrl(info.auth_url);
      setOauthPending(true);
      setLoading(false);

      await onCompleteOAuth();
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
      setOauthPending(false);
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
    if (oauthPending) {
      void onCancelOAuth().catch((err) => console.error("Failed to cancel login:", err));
      setOauthPending(false);
      setLoading(false);
    }
    setError(null);
    setActiveTab(tab);
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
      <DialogContent className="max-w-2xl gap-5 [&>button]:right-5 [&>button]:top-5 [&>button]:rounded-full [&>button]:border [&>button]:border-transparent [&>button]:bg-background/70 [&>button]:p-1.5 [&>button]:text-muted-foreground [&>button]:hover:bg-muted/70 [&>button]:hover:text-foreground">
        <DialogHeader className="gap-2 pr-10">
          <DialogTitle className="text-[2rem] leading-none tracking-[-0.03em]">
            Add Account
          </DialogTitle>
          <DialogDescription>
            Choose how you want to add this account.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
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
          <div className="rounded-2xl border border-border/70 bg-muted/14 p-5">
            {oauthPending ? (
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="rounded-full border border-border/70 bg-background/80 p-2">
                    <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <div className="text-sm font-medium">Browser login is waiting</div>
                    <div className="text-sm text-muted-foreground">
                      Open the generated link and finish authentication.
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Login URL
                  </div>
                  <Input readOnly value={authUrl} className="font-mono text-xs" />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(authUrl)
                          .then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1500);
                          })
                          .catch(() => setError("Clipboard unavailable. Copy the URL manually."));
                      }}
                    >
                      <Copy />
                      {copied ? "Copied" : "Copy URL"}
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => void openExternalUrl(authUrl)}>
                      <ExternalLink />
                      Open in Browser
                    </Button>
                  </div>
                </div>

                {!tauriRuntime ? (
                  <p className="rounded-xl border border-amber-300/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:border-amber-800/70 dark:text-amber-300">
                    The callback uses `localhost`, so the browser flow must complete on the same host.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="rounded-full border border-border/70 bg-background/80 p-2">
                    <Globe className="size-4 text-muted-foreground" />
                  </div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Generate a secure login link and finish sign-in in your browser.</p>
                    <p>Email and account metadata are pulled automatically after login.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border border-border/70 bg-muted/14 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-full border border-border/70 bg-background/80 p-2">
                <FileJson2 className="size-4 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-4">
                <div className="text-sm text-muted-foreground">
                  Choose a Codex `auth.json` file to import this account.
                </div>
                <div className="flex gap-2">
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
          <div className="rounded-xl border border-amber-300/50 bg-amber-500/8 px-4 py-3 text-sm text-amber-800 dark:border-amber-800/70 dark:text-amber-200">
            {error}
          </div>
        ) : null}

        <DialogFooter className="pt-1">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void (activeTab === "oauth" ? handleOAuthLogin() : handleImportFile())}
            disabled={loading || (activeTab === "oauth" && oauthPending)}
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
