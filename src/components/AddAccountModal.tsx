import { useState } from "react";
import { Copy, ExternalLink, FileJson2, Globe, LoaderCircle } from "lucide-react";

import {
  describeFileSource,
  isTauriRuntime,
  openExternalUrl,
  pickAuthJsonFile,
  type FileSource,
} from "@/lib/platform";
import { Badge } from "@/components/ui/badge";
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

  const tabClass = (tab: Tab) =>
    activeTab === tab ? "border-border bg-background text-foreground" : "text-muted-foreground";

  return (
    <Dialog open={isOpen} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <Badge variant="outline">Account Intake</Badge>
            <Badge variant="default">Name = Email</Badge>
          </div>
          <DialogTitle>Add Account</DialogTitle>
          <DialogDescription>
            New ChatGPT accounts use the email address as the saved account name.
          </DialogDescription>
        </DialogHeader>

        <div className="inline-flex rounded-xl border bg-muted/40 p-1">
          <button
            type="button"
            onClick={() => {
              if (oauthPending) {
                void onCancelOAuth().catch((err) => console.error("Failed to cancel login:", err));
                setOauthPending(false);
                setLoading(false);
              }
              setError(null);
              setActiveTab("oauth");
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tabClass("oauth")}`}
          >
            Browser Login
          </button>
          <button
            type="button"
            onClick={() => {
              if (oauthPending) {
                void onCancelOAuth().catch((err) => console.error("Failed to cancel login:", err));
                setOauthPending(false);
                setLoading(false);
              }
              setError(null);
              setActiveTab("import");
            }}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${tabClass("import")}`}
          >
            Import `auth.json`
          </button>
        </div>

        {activeTab === "oauth" ? (
          <div className="rounded-2xl border bg-muted/25 p-4">
            {oauthPending ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                  <div>
                    <div className="text-sm font-medium">Waiting for browser login</div>
                    <div className="text-sm text-muted-foreground">
                      Open the generated link and complete the ChatGPT authentication flow.
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Login URL
                  </div>
                  <div className="flex gap-2">
                    <Input readOnly value={authUrl} className="font-mono text-xs" />
                    <Button
                      variant="outline"
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
                      {copied ? "Copied" : "Copy"}
                    </Button>
                    <Button variant="outline" onClick={() => void openExternalUrl(authUrl)}>
                      <ExternalLink />
                      Open
                    </Button>
                  </div>
                </div>

                {!tauriRuntime ? (
                  <p className="text-sm text-amber-600 dark:text-amber-300">
                    The callback uses `localhost`, so the browser flow must complete on the same host.
                  </p>
                ) : null}
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <Globe className="mt-0.5 size-4 text-muted-foreground" />
                  <div className="space-y-1 text-sm text-muted-foreground">
                    <p>Generate a login link, authenticate in the browser, and the account will be added automatically.</p>
                    <p>Email, plan type, and team metadata are pulled after login.</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-2xl border bg-muted/25 p-4">
            <div className="flex items-start gap-3">
              <FileJson2 className="mt-0.5 size-4 text-muted-foreground" />
              <div className="flex-1 space-y-3">
                <div className="text-sm text-muted-foreground">
                  Import credentials from an existing Codex `auth.json` file. The saved account name is derived from the imported email.
                </div>
                <div className="flex gap-2">
                  <Input readOnly value={describeFileSource(fileSource)} />
                  <Button variant="outline" onClick={() => void handleSelectFile()}>
                    Browse
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {error ? (
          <div className="rounded-xl border border-red-200/70 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300">
            {error}
          </div>
        ) : null}

        <DialogFooter>
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
