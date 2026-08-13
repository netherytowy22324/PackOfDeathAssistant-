import { useState, useRef, useEffect } from "react";
import { useSendRconCommand } from "@workspace/api-client-react";
import { Terminal, Send, ServerCrash } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface TerminalEntry {
  id: string;
  type: 'command' | 'output' | 'error';
  content: string;
}

export default function Rcon() {
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<TerminalEntry[]>([
    { id: 'welcome', type: 'output', content: 'RCON Connection Established. Awaiting commands...' }
  ]);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendCommand = useSendRconCommand({
    mutation: {
      onSuccess: (data, variables) => {
        setHistory(prev => [
          ...prev,
          { id: Date.now() + '-out', type: data.success ? 'output' : 'error', content: data.output || (data.success ? 'Command executed successfully (no output).' : 'Command failed without output.') }
        ]);
      },
      onError: (error) => {
        setHistory(prev => [
          ...prev,
          { id: Date.now() + '-err', type: 'error', content: error.message || 'Failed to connect to RCON.' }
        ]);
      }
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [history]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || sendCommand.isPending) return;

    const cmd = input.trim();
    setHistory(prev => [...prev, { id: Date.now() + '-cmd', type: 'command', content: cmd }]);
    setCommandHistory(prev => [cmd, ...prev]);
    setHistoryIndex(-1);
    setInput("");
    
    sendCommand.mutate({ data: { command: cmd } });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (historyIndex < commandHistory.length - 1) {
        const nextIndex = historyIndex + 1;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
      }
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex > 0) {
        const nextIndex = historyIndex - 1;
        setHistoryIndex(nextIndex);
        setInput(commandHistory[nextIndex]);
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setInput("");
      }
    }
  };

  return (
    <div className="space-y-6 h-[calc(100vh-8rem)] flex flex-col">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">RCON Console</h1>
        <p className="text-muted-foreground mt-1">Direct terminal access to the Minecraft server.</p>
      </div>

      <Card className="flex-1 flex flex-col bg-black/90 border-border overflow-hidden rounded-lg shadow-2xl">
        <div className="bg-muted/20 border-b border-border px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wider font-mono">
            <Terminal className="w-4 h-4 text-primary" />
            Interactive Shell
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" />
            <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-mono">Connected</span>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 font-mono text-sm space-y-2">
          {history.map((entry) => (
            <div key={entry.id} className="whitespace-pre-wrap break-all">
              {entry.type === 'command' && (
                <div className="text-foreground flex gap-2">
                  <span className="text-primary opacity-50">&gt;</span>
                  {entry.content}
                </div>
              )}
              {entry.type === 'output' && (
                <div className="text-muted-foreground ml-4">
                  {entry.content}
                </div>
              )}
              {entry.type === 'error' && (
                <div className="text-destructive ml-4 flex items-start gap-2">
                  <ServerCrash className="w-4 h-4 shrink-0 mt-0.5" />
                  {entry.content}
                </div>
              )}
            </div>
          ))}
          {sendCommand.isPending && (
            <div className="text-primary animate-pulse ml-4 font-mono">...</div>
          )}
          <div ref={bottomRef} />
        </div>

        <form onSubmit={handleSubmit} className="p-4 bg-muted/10 border-t border-border flex gap-4 items-center">
          <span className="text-primary font-mono text-lg shrink-0">&gt;</span>
          <Input 
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-none focus-visible:ring-0 px-0 font-mono text-base placeholder:text-muted-foreground/30 rounded-none shadow-none"
            placeholder="Enter RCON command..."
            autoFocus
            autoComplete="off"
            spellCheck="false"
          />
          <Button 
            type="submit" 
            size="icon" 
            disabled={!input.trim() || sendCommand.isPending}
            className="shrink-0"
          >
            <Send className="w-4 h-4" />
          </Button>
        </form>
      </Card>
    </div>
  );
}
