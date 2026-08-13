import { useState, useRef, useEffect } from "react";
import {
  useGetSystemLogs,
  useGetChatLogs,
  getGetSystemLogsQueryKey,
  getGetChatLogsQueryKey,
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import { Terminal, MessageSquare, AlertTriangle, Info, AlertCircle, RefreshCw, ArrowDown } from "lucide-react";

function LiveBadge({ isFetching }: { isFetching: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-2 h-2 rounded-full ${isFetching ? "bg-amber-400 animate-pulse" : "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"}`} />
      <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
        {isFetching ? "Aktualizowanie..." : "Na żywo"}
      </span>
    </div>
  );
}

function SystemLogsTab() {
  const [level, setLevel] = useState<string>("all");
  const [limit, setLimit] = useState<string>("100");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const params = {
    limit: parseInt(limit),
    level: level === "all" ? undefined : level,
  };
  const { data, isLoading, isError, refetch, isFetching } = useGetSystemLogs(params, {
    query: { refetchInterval: 5000, queryKey: getGetSystemLogsQueryKey(params) },
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, autoScroll]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <LiveBadge isFetching={isFetching} />
        <div className="flex items-center gap-2">
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-[150px] bg-card h-8 text-sm">
              <SelectValue placeholder="Poziom" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Ostrzeżenia</SelectItem>
              <SelectItem value="error">Błędy</SelectItem>
            </SelectContent>
          </Select>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-[100px] bg-card h-8 text-sm">
              <SelectValue placeholder="Limit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 wpisów</SelectItem>
              <SelectItem value="100">100 wpisów</SelectItem>
              <SelectItem value="200">200 wpisów</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setAutoScroll(!autoScroll)} className={`h-8 gap-1.5 text-xs ${autoScroll ? "text-primary border-primary/40" : ""}`}>
            <ArrowDown className="w-3.5 h-3.5" />
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Odśwież
          </Button>
        </div>
      </div>

      <div className="bg-black/90 border border-border rounded-lg overflow-hidden font-mono text-sm leading-relaxed flex flex-col" style={{ height: "calc(100vh - 340px)", minHeight: "400px" }}>
        <div className="bg-card/50 border-b border-border px-4 py-2 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <Terminal className="w-4 h-4" />
          Strumień Logów Systemowych
          {data?.rows.length != null && (
            <Badge variant="secondary" className="ml-auto font-mono text-[10px]">{data.rows.length} wpisów</Badge>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {isLoading ? (
            <div className="text-muted-foreground animate-pulse">Łączenie ze strumieniem logów...</div>
          ) : isError ? (
            <div className="text-destructive">Błąd ładowania logów.</div>
          ) : data?.rows.length === 0 ? (
            <div className="text-muted-foreground">Brak logów spełniających kryteria.</div>
          ) : (
            data?.rows.map((log) => {
              const LogIcon = log.level === "error" ? AlertTriangle : log.level === "warn" ? AlertCircle : Info;
              const colorClass =
                log.level === "error" ? "text-red-500" : log.level === "warn" ? "text-amber-500" : "text-blue-400";
              return (
                <div key={log.id} className="flex gap-3 hover:bg-white/5 py-0.5 px-2 rounded -mx-2">
                  <span className="text-muted-foreground shrink-0 text-[11px] w-[130px] pt-0.5">
                    {format(new Date(log.createdAt), "MM-dd HH:mm:ss")}
                  </span>
                  <span className={`shrink-0 w-[55px] flex items-center gap-1 text-[11px] ${colorClass}`}>
                    <LogIcon className="w-3 h-3 shrink-0" />
                    {log.level.toUpperCase()}
                  </span>
                  <span className="text-purple-400 shrink-0 w-[110px] truncate text-[11px] pt-0.5">
                    [{log.service}]
                  </span>
                  <span className="text-foreground/90 flex-1 break-all text-[11px] pt-0.5">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function ChatLogsTab() {
  const [source, setSource] = useState<string>("all");
  const [limit, setLimit] = useState<string>("100");
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  const params = {
    limit: parseInt(limit),
    source: source === "all" ? undefined : source,
  };
  const { data, isLoading, isError, refetch, isFetching } = useGetChatLogs(params, {
    query: { refetchInterval: 5000, queryKey: getGetChatLogsQueryKey(params) },
  });

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data, autoScroll]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <LiveBadge isFetching={isFetching} />
        <div className="flex items-center gap-2">
          <Select value={source} onValueChange={setSource}>
            <SelectTrigger className="w-[160px] bg-card h-8 text-sm">
              <SelectValue placeholder="Źródło" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie źródła</SelectItem>
              <SelectItem value="mc">⛏️ Minecraft</SelectItem>
              <SelectItem value="dc">💬 Discord</SelectItem>
            </SelectContent>
          </Select>
          <Select value={limit} onValueChange={setLimit}>
            <SelectTrigger className="w-[100px] bg-card h-8 text-sm">
              <SelectValue placeholder="Limit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="50">50 wpisów</SelectItem>
              <SelectItem value="100">100 wpisów</SelectItem>
              <SelectItem value="200">200 wpisów</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => setAutoScroll(!autoScroll)} className={`h-8 gap-1.5 text-xs ${autoScroll ? "text-primary border-primary/40" : ""}`}>
            <ArrowDown className="w-3.5 h-3.5" />
            Auto-scroll {autoScroll ? "ON" : "OFF"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching} className="h-8 gap-1.5 text-xs">
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? "animate-spin" : ""}`} />
            Odśwież
          </Button>
        </div>
      </div>

      <div className="bg-black/90 border border-border rounded-lg overflow-hidden font-mono text-sm leading-relaxed flex flex-col" style={{ height: "calc(100vh - 340px)", minHeight: "400px" }}>
        <div className="bg-card/50 border-b border-border px-4 py-2 flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider">
          <MessageSquare className="w-4 h-4" />
          Strumień Czatu MC↔DC
          {data?.rows.length != null && (
            <Badge variant="secondary" className="ml-auto font-mono text-[10px]">{data.rows.length} wiadomości</Badge>
          )}
        </div>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-0.5">
          {isLoading ? (
            <div className="text-muted-foreground animate-pulse">Łączenie ze strumieniem czatu...</div>
          ) : isError ? (
            <div className="text-destructive">Błąd ładowania czatu.</div>
          ) : data?.rows.length === 0 ? (
            <div className="text-muted-foreground">Brak wiadomości czatu.</div>
          ) : (
            data?.rows.map((log) => {
              const isMc = log.source === "mc";
              return (
                <div key={log.id} className="flex gap-3 hover:bg-white/5 py-0.5 px-2 rounded -mx-2">
                  <span className="text-muted-foreground shrink-0 text-[11px] w-[130px] pt-0.5">
                    {format(new Date(log.createdAt), "MM-dd HH:mm:ss")}
                  </span>
                  <span className={`shrink-0 w-[30px] font-bold text-[11px] pt-0.5 ${isMc ? "text-green-500" : "text-blue-500"}`}>
                    {isMc ? "⛏️" : "💬"}
                  </span>
                  <span className="text-primary shrink-0 w-[150px] truncate text-[11px] pt-0.5 flex items-center">
                    &lt;{log.author}&gt;
                  </span>
                  <span className="text-foreground/90 flex-1 break-all text-[11px] pt-0.5">{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export default function Logs() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Logi Systemowe</h1>
        <p className="text-muted-foreground mt-1">Zdarzenia systemowe i strumień czatu w czasie rzeczywistym.</p>
      </div>

      <Tabs defaultValue="system" className="w-full">
        <TabsList className="bg-card border border-border">
          <TabsTrigger value="system" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Zdarzenia Systemowe
          </TabsTrigger>
          <TabsTrigger value="chat" className="data-[state=active]:bg-primary/20 data-[state=active]:text-primary">
            Czat Logs
          </TabsTrigger>
        </TabsList>
        <TabsContent value="system" className="mt-6">
          <SystemLogsTab />
        </TabsContent>
        <TabsContent value="chat" className="mt-6">
          <ChatLogsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
