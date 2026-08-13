import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Terminal, ArrowLeft, LayoutDashboard } from "lucide-react";

export default function NotFound() {
  const [, navigate] = useLocation();

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-4">
      <div className="text-center space-y-6 max-w-sm">
        <div className="w-20 h-20 rounded-2xl bg-card border border-border flex items-center justify-center mx-auto shadow-2xl shadow-primary/10">
          <Terminal className="w-10 h-10 text-primary opacity-50" />
        </div>

        <div className="space-y-2">
          <p className="text-6xl font-bold font-mono text-primary/30">404</p>
          <h1 className="text-2xl font-bold tracking-tight">Strona nie istnieje</h1>
          <p className="text-muted-foreground text-sm">
            Ta sekcja panelu nie istnieje lub adres URL jest niepoprawny.
          </p>
        </div>

        <div className="flex gap-3 justify-center">
          <Button variant="outline" onClick={() => history.back()} className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            Wróć
          </Button>
          <Button onClick={() => navigate("/")} className="gap-2">
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
