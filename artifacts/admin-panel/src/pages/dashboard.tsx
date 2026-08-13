import { useState } from "react";
import {
  useGetDashboardStats,
  getGetDashboardStatsQueryKey,
  useRestartMcBot,
  useReconnectDiscordBot,
  useSetMaintenance,
  useRestartSync,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Activity,
  Server,
  MessageSquare,
  ShieldAlert,
  Power,
  RefreshCw,
  Zap,
  Globe,
  AlertTriangle,
  Terminal,
  Users,
  MailCheck,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";

function StatusDot({ isOnline }: { isOnline: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-2.5 h-2.5 rounded-full ${
          isOnline
            ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse"
            : "bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)]"
        }`}
      />
      <span className="text-sm font-semibold tracking-wide">
        {isOnline ? "ONLINE" : "OFFLINE"}
      </span>
    </div>
  );
}

function formatUptime(seconds: number) {
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

type ConfirmAction = "restart-mc" | "restart-discord" | "restart-sync" | "maintenance" | null;

export default function Dashboard() {
  const [confirmAction, setConfirmAction] = useState<ConfirmAction>(null);

  const { data, isLoading, isError, refetch, isFetching } = useGetDashboardStats({
    query: {
      refetchInterval: 10000,
      queryKey: getGetDashboardStatsQueryKey(),
    },
  });

  const restartMc = useRestartMcBot({
    mutation: {
      onSuccess: () => {
        toast({ title: "Komenda wysłana", description: "Restartowanie bota Minecraft..." });
        refetch();
      },
      onError: () => toast({ title: "Błąd", description: "Nie udało się zrestartować bota MC.", variant: "destructive" }),
    },
  });

  const reconnectDiscord = useReconnectDiscordBot({
    mutation: {
      onSuccess: () => {
        toast({ title: "Komenda wysłana", description: "Ponowne łączenie z Discordem..." });
        refetch();
      },
      onError: () => toast({ title: "Błąd", description: "Nie udało się połączyć z Discordem.", variant: "destructive" }),
    },
  });

  const restartSync = useRestartSync({
    mutation: {
      onSuccess: () => {
        toast({ title: "Komenda wysłana", description: "Restartowanie synchronizacji..." });
        refetch();
      },
      onError: () => toast({ title: "Błąd", description: "Nie udało się zrestartować synchronizacji.", variant: "destructive" }),
    },
  });

  const setMaintenance = useSetMaintenance({
    mutation: {
      onSuccess: () => {
        toast({ title: "Tryb konserwacji", description: "Konfiguracja systemu zaktualizowana." });
        refetch();
      },
      onError: () => toast({ title: "Błąd", description: "Nie udało się zmienić trybu konserwacji.", variant: "destructive" }),
    },
  });

  const executeConfirmed = () => {
    if (!data) return;
    switch (confirmAction) {
      case "restart-mc": restartMc.mutate(); break;
      case "restart-discord": reconnectDiscord.mutate(); break;
      case "restart-sync": restartSync.mutate(); break;
      case "maintenance": setMaintenance.mutate({ data: { enabled: !data.sync.maintenance } }); break;
    }
    setConfirmAction(null);
  };

  const confirmLabels: Record<NonNullable<ConfirmAction>, { title: string; desc: string }> = {
    "restart-mc": { title: "Restartować bota Minecraft?", desc: "Bot rozłączy się z serwerem i połączy ponownie. Może to chwilę potrwać." },
    "restart-discord": { title: "Ponownie połączyć bota Discord?", desc: "Bot Discord rozłączy się i zaloguje ponownie." },
    "restart-sync": { title: "Restartować synchronizację?", desc: "Serwis synchronizacji czatu zostanie zrestartowany." },
    "maintenance": { title: data?.sync.maintenance ? "Wyłączyć tryb konserwacji?" : "Włączyć tryb konserwacji?", desc: data?.sync.maintenance ? "Synchronizacja czatu zostanie wznowiona." : "Synchronizacja czatu zostanie wstrzymana do czasu wyłączenia trybu konserwacji." },
  };

  if (isLoading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-card rounded w-48" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => <div key={i} className="h-32 bg-card rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertTriangle className="w-12 h-12 text-destructive opacity-50" />
        <p className="text-muted-foreground">Nie można załadować danych dashboardu.</p>
        <Button variant="outline" onClick={() => refetch()}>Spróbuj ponownie</Button>
      </div>
    );
  }

  const { discord, minecraft, rcon, sync, stats, recentErrors } = data;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Status Systemu</h1>
          <p className="text-muted-foreground mt-1">Monitorowanie i sterowanie mostem PackSMP.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="gap-2">
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Odśwież
        </Button>
      </div>

      {/* Status cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="border-t-4 border-t-blue-500 bg-gradient-to-b from-blue-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Discord Bot</p>
                <StatusDot isOnline={discord.connected} />
              </div>
              <MessageSquare className="w-5 h-5 text-blue-500" />
            </div>
            <div className="space-y-1.5 mt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Konto</span>
                <span className="font-mono text-foreground truncate max-w-[120px]">{discord.username || "Brak"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Serwery</span>
                <span className="font-mono text-foreground">{discord.guilds}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-green-500 bg-gradient-to-b from-green-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Bot Minecraft</p>
                <StatusDot isOnline={minecraft.connected} />
              </div>
              <Globe className="w-5 h-5 text-green-500" />
            </div>
            <div className="space-y-1.5 mt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Nick</span>
                <span className="font-mono text-foreground">{minecraft.username}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Serwer</span>
                <span className="font-mono text-foreground text-xs">{minecraft.host}:{minecraft.port}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-amber-500 bg-gradient-to-b from-amber-500/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">RCON</p>
                <StatusDot isOnline={rcon.connected} />
              </div>
              <Terminal className="w-5 h-5 text-amber-500" />
            </div>
            <div className="space-y-1.5 mt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Host</span>
                <span className="font-mono text-foreground text-xs">{rcon.host}:{rcon.port}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stan</span>
                <span className="font-mono text-foreground text-xs">{rcon.connected ? "Połączony" : "Rozłączony"}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-t-4 border-t-primary bg-gradient-to-b from-primary/5 to-transparent">
          <CardContent className="pt-6">
            <div className="flex justify-between items-start mb-4">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Synchronizacja</p>
                <StatusDot isOnline={sync.enabled && !sync.maintenance} />
              </div>
              <Activity className="w-5 h-5 text-primary" />
            </div>
            <div className="space-y-1.5 mt-4 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Stan</span>
                <Badge
                  variant={sync.maintenance ? "destructive" : sync.enabled ? "default" : "secondary"}
                  className="font-mono text-[10px]"
                >
                  {sync.maintenance ? "KONSERWACJA" : sync.enabled ? "AKTYWNA" : "WYŁĄCZONA"}
                </Badge>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Uptime</span>
                <span className="font-mono text-foreground">{formatUptime(stats.uptimeSeconds)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Metrics + Errors */}
        <div className="lg:col-span-2 space-y-6">
          <h2 className="text-xl font-semibold">Statystyki</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-card border border-border p-4 rounded-lg flex flex-col items-center justify-center text-center gap-1">
              <Users className="w-4 h-4 text-primary mb-1 opacity-60" />
              <span className="text-4xl font-bold font-mono text-primary">{stats.verifiedAccounts}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Zweryfikowanych</span>
            </div>
            <div className="bg-card border border-border p-4 rounded-lg flex flex-col items-center justify-center text-center gap-1">
              <MailCheck className="w-4 h-4 text-amber-500 mb-1 opacity-60" />
              <span className="text-4xl font-bold font-mono text-amber-500">{stats.pendingMessages}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Oczekujące Msg</span>
            </div>
            <div className="bg-card border border-border p-4 rounded-lg flex flex-col items-center justify-center text-center gap-1">
              <AlertTriangle className="w-4 h-4 text-destructive mb-1 opacity-60" />
              <span className="text-4xl font-bold font-mono text-destructive">{stats.totalErrors}</span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Błędy</span>
            </div>
            <div className="bg-card border border-border p-4 rounded-lg flex flex-col items-center justify-center text-center gap-1">
              <Server className="w-4 h-4 text-foreground mb-1 opacity-30" />
              <span className="text-4xl font-bold font-mono text-foreground">
                {Math.round(stats.uptimeSeconds / 3600)}<span className="text-xl text-muted-foreground">h</span>
              </span>
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider">Uptime</span>
            </div>
          </div>

          <Card>
            <CardHeader className="pb-3 border-b border-border">
              <CardTitle className="text-sm font-medium uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-destructive" />
                Ostatnie błędy systemowe
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {recentErrors.length === 0 ? (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  ✅ System działa poprawnie. Brak błędów.
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {recentErrors.map((error) => (
                    <div key={error.id} className="p-4 flex gap-4 hover:bg-muted/50 transition-colors">
                      <div className="mt-1">
                        <div className="w-2 h-2 rounded-full bg-destructive shadow-[0_0_8px_rgba(239,68,68,0.5)]" />
                      </div>
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex justify-between gap-2">
                          <span className="font-mono text-sm font-medium text-destructive">{error.service}</span>
                          <span className="text-xs text-muted-foreground shrink-0">
                            {formatDistanceToNow(new Date(error.createdAt), { addSuffix: true, locale: pl })}
                          </span>
                        </div>
                        <p className="text-sm text-foreground/90 break-words">{error.message}</p>
                        {error.context && (
                          <div className="mt-2 bg-background p-2 rounded border border-border font-mono text-xs text-muted-foreground overflow-x-auto">
                            {error.context}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Command Console */}
        <div className="space-y-6">
          <h2 className="text-xl font-semibold">Konsola Sterowania</h2>

          <Card className="bg-card/50">
            <CardContent className="p-4 space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start border-green-500/30 hover:bg-green-500/10 hover:text-green-400"
                onClick={() => setConfirmAction("restart-mc")}
                disabled={restartMc.isPending}
              >
                <Power className="w-4 h-4 mr-3" />
                Restartuj bota Minecraft
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start border-blue-500/30 hover:bg-blue-500/10 hover:text-blue-400"
                onClick={() => setConfirmAction("restart-discord")}
                disabled={reconnectDiscord.isPending}
              >
                <RefreshCw className="w-4 h-4 mr-3" />
                Połącz ponownie Discord
              </Button>

              <Button
                variant="outline"
                className="w-full justify-start border-primary/30 hover:bg-primary/10 hover:text-primary"
                onClick={() => setConfirmAction("restart-sync")}
                disabled={restartSync.isPending}
              >
                <Zap className="w-4 h-4 mr-3" />
                Restartuj synchronizację
              </Button>

              <div className="pt-4 mt-2 border-t border-border">
                <Button
                  variant={sync.maintenance ? "destructive" : "secondary"}
                  className={`w-full justify-start ${sync.maintenance ? "animate-pulse bg-destructive/20 text-destructive border-destructive/50" : ""}`}
                  onClick={() => setConfirmAction("maintenance")}
                  disabled={setMaintenance.isPending}
                >
                  <ShieldAlert className="w-4 h-4 mr-3" />
                  {sync.maintenance ? "Wyłącz tryb konserwacji" : "Włącz tryb konserwacji"}
                </Button>
                <p className="text-xs text-muted-foreground mt-2 text-center">
                  Tryb konserwacji wstrzymuje synchronizację czatu.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Confirmation Dialog */}
      <AlertDialog open={confirmAction !== null} onOpenChange={(open) => { if (!open) setConfirmAction(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmAction ? confirmLabels[confirmAction].title : ""}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction ? confirmLabels[confirmAction].desc : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Anuluj</AlertDialogCancel>
            <AlertDialogAction onClick={executeConfirmed}>Potwierdź</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
