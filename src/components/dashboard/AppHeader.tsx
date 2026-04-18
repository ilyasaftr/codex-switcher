import {
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleOff,
  Download,
  FolderSync,
  Moon,
  Plus,
  RefreshCw,
  SunMedium,
  Upload,
  WalletCards,
  Zap,
} from "lucide-react";

import type { CodexProcessInfo } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type ThemeMode = "light" | "dark";

interface AppHeaderProps {
  processInfo: CodexProcessInfo | null;
  allMasked: boolean;
  themeMode: ThemeMode;
  isRefreshing: boolean;
  isWarmingAll: boolean;
  accountsCount: number;
  lastUpdatedLabel: string;
  onToggleMaskAll: () => void;
  onRefreshAll: () => void;
  onWarmupAll: () => void;
  onToggleTheme: () => void;
  onAddAccount: () => void;
  onExportSlim: () => void;
  onImportSlim: () => void;
  onExportFull: () => void;
  onImportFull: () => void;
  isExportingSlim: boolean;
  isImportingSlim: boolean;
  isExportingFull: boolean;
  isImportingFull: boolean;
}

export function AppHeader({
  processInfo,
  allMasked,
  themeMode,
  isRefreshing,
  isWarmingAll,
  accountsCount,
  lastUpdatedLabel,
  onToggleMaskAll,
  onRefreshAll,
  onWarmupAll,
  onToggleTheme,
  onAddAccount,
  onExportSlim,
  onImportSlim,
  onExportFull,
  onImportFull,
  isExportingSlim,
  isImportingSlim,
  isExportingFull,
  isImportingFull,
}: AppHeaderProps) {
  const hasRunningProcesses = Boolean(processInfo && processInfo.count > 0);

  return (
    <header className="sticky top-0 z-40 border-b bg-background/88 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-5 py-5 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">Codex Switcher</h1>
              <Badge variant={hasRunningProcesses ? "warning" : "success"}>
                {hasRunningProcesses
                  ? `${processInfo?.count ?? 0} Codex running`
                  : "No active Codex session"}
              </Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span>{accountsCount} configured account{accountsCount === 1 ? "" : "s"}</span>
              <span>·</span>
              <span>Last updated {lastUpdatedLabel}</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={onToggleMaskAll}>
              {allMasked ? <CircleOff /> : <WalletCards />}
              {allMasked ? "Reveal All" : "Hide All"}
            </Button>

            <Button variant="outline" onClick={onRefreshAll} disabled={isRefreshing}>
              <RefreshCw className={isRefreshing ? "animate-spin" : undefined} />
              {isRefreshing ? "Refreshing" : "Refresh All"}
            </Button>

            <Button variant="outline" onClick={onWarmupAll} disabled={isWarmingAll || accountsCount === 0}>
              <Zap className={isWarmingAll ? "animate-pulse" : undefined} />
              {isWarmingAll ? "Warming" : "Warm-up All"}
            </Button>

            <Button variant="outline" onClick={onToggleTheme}>
              {themeMode === "dark" ? <SunMedium /> : <Moon />}
              {themeMode === "dark" ? "Light" : "Dark"}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  <FolderSync />
                  Accounts
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel>Account Actions</DropdownMenuLabel>
                <DropdownMenuItem onClick={onAddAccount}>
                  <Plus />
                  Add Account
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onExportSlim} disabled={isExportingSlim}>
                  <Upload />
                  {isExportingSlim ? "Exporting Slim Text" : "Export Slim Text"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onImportSlim} disabled={isImportingSlim}>
                  <ArrowDownToLine />
                  {isImportingSlim ? "Preparing Import" : "Import Slim Text"}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={onExportFull} disabled={isExportingFull}>
                  <Download />
                  {isExportingFull ? "Exporting Full Backup" : "Export Full Backup"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={onImportFull} disabled={isImportingFull}>
                  <ArrowUpFromLine />
                  {isImportingFull ? "Importing Full Backup" : "Import Full Backup"}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>
    </header>
  );
}
