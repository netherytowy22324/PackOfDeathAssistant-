import { useState, useEffect } from "react";
import { useGetVerifications, useDeleteVerification } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Search, Trash2, ShieldCheck, ShieldAlert, ChevronLeft, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetVerificationsQueryKey } from "@workspace/api-client-react";

export default function Verifications() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const limit = 20;

  const [debouncedSearch, setDebouncedSearch] = useState("");
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 500);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading, refetch } = useGetVerifications({
    page,
    limit,
    search: debouncedSearch || undefined
  });

  const queryClient = useQueryClient();

  const deleteMutation = useDeleteVerification({
    mutation: {
      onSuccess: () => {
        toast({ title: "Account Unlinked", description: "Verification removed." });
        queryClient.invalidateQueries({ queryKey: getGetVerificationsQueryKey() });
      }
    }
  });

  const handleDelete = (discordId: string) => {
    if (confirm("Are you sure you want to unlink this account?")) {
      deleteMutation.mutate({ discordId });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Verifications</h1>
          <p className="text-muted-foreground mt-1">Manage linked Discord and Minecraft accounts.</p>
        </div>
        
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input 
            placeholder="Search by Discord ID or MC Nick..." 
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="pl-9 font-mono text-sm bg-card"
          />
        </div>
      </div>

      <div className="border border-border rounded-lg bg-card overflow-hidden">
        <Table>
          <TableHeader className="bg-muted/50">
            <TableRow>
              <TableHead className="font-mono text-xs text-muted-foreground">STATUS</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">DISCORD ID</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">MC NICK</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">MC UUID</TableHead>
              <TableHead className="font-mono text-xs text-muted-foreground">LINKED DATE</TableHead>
              <TableHead className="w-[100px] text-right font-mono text-xs text-muted-foreground">ACTIONS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                  <div className="animate-pulse space-y-4">
                    {[1,2,3,4,5].map(i => <div key={i} className="h-6 bg-muted/50 rounded w-full"></div>)}
                  </div>
                </TableCell>
              </TableRow>
            ) : data?.rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-12 text-muted-foreground">
                  No verifications found.
                </TableCell>
              </TableRow>
            ) : (
              data?.rows.map((row) => (
                <TableRow key={row.id} className="hover:bg-muted/30">
                  <TableCell>
                    {row.isVerified ? (
                      <Badge variant="default" className="bg-green-500/10 text-green-500 hover:bg-green-500/20 border-green-500/20 gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        Verified
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <ShieldAlert className="w-3 h-3" />
                        Pending
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{row.discordId}</TableCell>
                  <TableCell className="font-mono text-sm text-primary">{row.mcNick || '-'}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">{row.mcUuid || '-'}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {row.verifiedAt ? format(new Date(row.verifiedAt), "MMM d, yyyy HH:mm") : '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button 
                      variant="ghost" 
                      size="icon" 
                      className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      onClick={() => handleDelete(row.discordId)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data && data.total > limit && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Showing {(page - 1) * limit + 1} to {Math.min(page * limit, data.total)} of {data.total}
          </p>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Prev
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={() => setPage(p => p + 1)}
              disabled={page * limit >= data.total}
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
