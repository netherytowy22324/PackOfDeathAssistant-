import { useState } from "react";
import { useGetConfig, useUpdateConfig, useSetMaintenance } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Edit2, Save, X, Database, Settings, ShieldAlert, Cpu } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetConfigQueryKey } from "@workspace/api-client-react";

function ConfigRow({ item }: { item: { key: string, value: string, updatedAt: string } }) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(item.value);
  const queryClient = useQueryClient();

  const updateMutation = useUpdateConfig({
    mutation: {
      onSuccess: () => {
        toast({ title: "Configuration Updated", description: `Saved new value for ${item.key}.` });
        setIsEditing(false);
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
      }
    }
  });

  const handleSave = () => {
    updateMutation.mutate({ data: { key: item.key, value: editValue } });
  };

  return (
    <TableRow className="hover:bg-muted/30">
      <TableCell className="font-mono text-sm font-medium w-1/3">{item.key}</TableCell>
      <TableCell className="w-1/2">
        {isEditing ? (
          <Input 
            value={editValue} 
            onChange={(e) => setEditValue(e.target.value)}
            className="h-8 font-mono text-sm bg-background"
            autoFocus
          />
        ) : (
          <span className="font-mono text-sm text-muted-foreground">{item.value || <span className="opacity-50 italic">empty</span>}</span>
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground text-right">
        {formatDistanceToNow(new Date(item.updatedAt), { addSuffix: true })}
      </TableCell>
      <TableCell className="text-right">
        {isEditing ? (
          <div className="flex justify-end gap-2">
            <Button size="icon" variant="ghost" className="h-8 w-8 text-green-500 hover:text-green-400 hover:bg-green-500/10" onClick={handleSave} disabled={updateMutation.isPending}>
              <Save className="w-4 h-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground" onClick={() => setIsEditing(false)}>
              <X className="w-4 h-4" />
            </Button>
          </div>
        ) : (
          <Button size="icon" variant="ghost" className="h-8 w-8 text-muted-foreground hover:text-primary" onClick={() => setIsEditing(true)}>
            <Edit2 className="w-4 h-4" />
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

export default function Config() {
  const { data, isLoading } = useGetConfig();
  const queryClient = useQueryClient();

  const setMaintenance = useSetMaintenance({
    mutation: {
      onSuccess: () => {
        toast({ title: "Runtime Updated", description: "Maintenance mode state changed." });
        queryClient.invalidateQueries({ queryKey: getGetConfigQueryKey() });
      }
    }
  });

  if (isLoading || !data) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-8 bg-card rounded w-64 mb-8"></div>
        <div className="h-64 bg-card rounded-lg"></div>
        <div className="h-64 bg-card rounded-lg"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">System Configuration</h1>
        <p className="text-muted-foreground mt-1">Manage database variables and view environment details.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card>
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Database className="w-5 h-5 text-primary" />
                <CardTitle>Database Variables</CardTitle>
              </div>
              <CardDescription>Persistent configuration synced across all nodes.</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="font-mono text-xs">KEY</TableHead>
                    <TableHead className="font-mono text-xs">VALUE</TableHead>
                    <TableHead className="text-right font-mono text-xs">UPDATED</TableHead>
                    <TableHead className="w-[100px] text-right font-mono text-xs">ACTION</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.db.map((item) => (
                    <ConfigRow key={item.key} item={item} />
                  ))}
                  {data.db.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                        No database variables found.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Settings className="w-5 h-5 text-muted-foreground" />
                <CardTitle>Environment Variables</CardTitle>
              </div>
              <CardDescription>Read-only configuration from the host environment.</CardDescription>
            </CardHeader>
            <CardContent className="p-4">
              <div className="bg-black/90 border border-border rounded p-4 font-mono text-sm space-y-2 overflow-x-auto">
                {Object.entries(data.env).map(([key, value]) => (
                  <div key={key} className="flex gap-4">
                    <span className="text-blue-400 shrink-0 min-w-[200px]">{key}</span>
                    <span className="text-green-400 break-all">= {value}</span>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card>
            <CardHeader className="border-b border-border bg-muted/20">
              <div className="flex items-center gap-2">
                <Cpu className="w-5 h-5 text-primary" />
                <CardTitle>Runtime Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm font-medium">Sync Service</p>
                  <p className="text-xs text-muted-foreground">Is the sync bridge currently active?</p>
                </div>
                <Badge variant={data.runtime.syncEnabled ? "default" : "secondary"}>
                  {data.runtime.syncEnabled ? "ACTIVE" : "STOPPED"}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium">Maintenance Mode</p>
                    {data.runtime.maintenanceMode && <ShieldAlert className="w-4 h-4 text-amber-500" />}
                  </div>
                  <p className="text-xs text-muted-foreground">Pause sync events across network</p>
                </div>
                <Switch 
                  checked={data.runtime.maintenanceMode} 
                  onCheckedChange={(checked) => setMaintenance.mutate({ data: { enabled: checked } })}
                  disabled={setMaintenance.isPending}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
