import { useState } from "react";
import { useGetMessages, useDeleteMessage, getGetMessagesQueryKey } from "@workspace/api-client-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Trash2, MessageSquare, Clock, CheckCircle2, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { pl } from "date-fns/locale";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

type StatusFilter = "all" | "pending" | "delivered";

export default function Messages() {
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch, isFetching } = useGetMessages(
    { limit: 100 },
    { query: { refetchInterval: 10000, queryKey: getGetMessagesQueryKey({ limit: 100 }) } }
  );

  const deleteMutation = useDeleteMessage({
    mutation: {
      onSuccess: () => {
        toast({ title: "Usunięto", description: "Wiadomość została usunięta." });
        queryClient.invalidateQueries({ queryKey: getGetMessagesQueryKey() });
      },
      onError: () => {
        toast({ title: "Błąd", description: "Nie udało się usunąć wiadomości.", variant: "destructive" });
      },
    },
  });

  const rows = data?.rows ?? [];
  const filtered = rows.filter((r) => {
    if (statusFilter === "pending") return !r.isDelivered;
    if (statusFilter === "delivered") return r.isDelivered;
    return true;
  });

  const pendingCount = rows.filter((r) => !r.isDelivered).length;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Prywatne Wiadomości</h1>
          <p className="text-muted-foreground mt-1">
            Kolejka wiadomości MC↔Discord.{" "}
            {pendingCount > 0 && (
              <span className="text-amber-500 font-medium">{pendingCount} oczekujących.</span>
            )}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          disabled={isFetching}
          className="gap-2 shrink-0"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? "animate-spin" : ""}`} />
          Odśwież
        </Button>
      </div>

      <div className="flex items-center gap-3">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
          <SelectTrigger className="w-[180px] bg-card">
            <SelectValue placeholder="Filtruj status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Wszystkie ({rows.length})</SelectItem>
            <SelectItem value="pending">Oczekujące ({pendingCount})</SelectItem>
            <SelectItem value="delivered">Dostarczone ({rows.length - pendingCount})</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="font-mono text-xs text-muted-foreground w-32">STATUS</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground w-48">NADAWCA</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground w-48">ODBIORCA</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground min-w-[300px]">TREŚĆ</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground w-32">CZAS</TableHead>
              <TableHead className="w-16 text-right"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8">
                  <div className="animate-pulse space-y-3">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div key={i} className="h-6 bg-muted/50 rounded w-full" />
                    ))}
                  </div>
                </TableCell>
              </TableRow>
            ) : isError ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-destructive">
                  Błąd ładowania wiadomości. Spróbuj odświeżyć.
                </TableCell>
              </TableRow>
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  <MessageSquare className="w-8 h-8 mx-auto mb-3 opacity-20" />
                  {statusFilter === "all" ? "Brak wiadomości." : `Brak wiadomości o statusie „${statusFilter === "pending" ? "oczekujące" : "dostarczone"}".`}
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  <TableCell>
                    {row.isDelivered ? (
                      <Badge variant="outline" className="bg-green-500/10 text-green-500 border-green-500/20 gap-1 font-mono text-[10px]">
                        <CheckCircle2 className="w-3 h-3" />
                        DOSTARCZONA
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="bg-amber-500/10 text-amber-500 border-amber-500/20 gap-1 font-mono text-[10px]">
                        <Clock className="w-3 h-3" />
                        OCZEKUJE
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                        {row.fromType === "mc" ? "⛏️ MC" : "💬 DC"}
                      </Badge>
                      <span className="font-medium text-sm">{row.fromDisplay}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm text-primary">{row.toId}</TableCell>
                  <TableCell>
                    <p className="text-sm text-foreground/90 line-clamp-2">{row.message}</p>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(row.createdAt), { addSuffix: true, locale: pl })}
                  </TableCell>
                  <TableCell className="text-right">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          disabled={deleteMutation.isPending}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Usunąć wiadomość?</AlertDialogTitle>
                          <AlertDialogDescription>
                            Tej operacji nie można cofnąć.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Anuluj</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => deleteMutation.mutate({ id: row.id })}
                          >
                            Usuń
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
