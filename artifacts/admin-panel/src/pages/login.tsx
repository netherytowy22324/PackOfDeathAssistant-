import { useState } from "react";
import { Terminal, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLogin } from "@workspace/api-client-react";
import { toast } from "@/hooks/use-toast";

interface LoginProps {
  onLogin: (token: string) => void;
}

export default function Login({ onLogin }: LoginProps) {
  const [password, setPassword] = useState("");

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data) => {
        toast({ title: "Authentication successful", description: "Welcome to PackSMP Ops" });
        onLogin(data.token);
      },
      onError: () => {
        toast({ title: "Authentication failed", description: "Invalid password", variant: "destructive" });
      },
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    loginMutation.mutate({ data: { password } });
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative overflow-hidden p-4">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-primary/10 via-background to-background pointer-events-none" />

      <div className="w-full max-w-sm space-y-8 relative z-10">
        <div className="flex flex-col items-center text-center space-y-4">
          <div className="w-16 h-16 rounded-xl bg-card border border-border flex items-center justify-center shadow-2xl shadow-primary/20">
            <Terminal className="w-8 h-8 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">PackSMP Ops Command</h1>
            <p className="text-muted-foreground text-sm mt-1">Provide authorization credential</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-card p-6 rounded-lg border border-border shadow-xl">
          <div className="space-y-2">
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-3 text-muted-foreground" />
              <Input
                type="password"
                placeholder="Passphrase"
                className="pl-9 font-mono tracking-wider"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={loginMutation.isPending || !password}
          >
            {loginMutation.isPending ? "Verifying..." : "Initialize Session"}
          </Button>
        </form>
      </div>
    </div>
  );
}
