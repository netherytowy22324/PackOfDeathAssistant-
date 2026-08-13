import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Users,
  MessageSquare,
  FileText,
  Settings,
  Terminal,
  LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/verifications", label: "Verifications", icon: Users },
  { href: "/messages", label: "Messages", icon: MessageSquare },
  { href: "/logs", label: "Logs", icon: FileText },
  { href: "/config", label: "Config", icon: Settings },
  { href: "/rcon", label: "RCON Console", icon: Terminal },
];

interface AppLayoutProps {
  children: ReactNode;
  onLogout: () => void;
}

export default function AppLayout({ children, onLogout }: AppLayoutProps) {
  const [location] = useLocation();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <aside className="w-full md:w-64 bg-card border-b md:border-r border-border flex flex-col flex-shrink-0 relative z-20 shadow-xl">
        <div className="h-16 flex items-center px-6 border-b border-border">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center border border-primary/50 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
              <Terminal className="w-4 h-4 text-primary" />
            </div>
            <span className="font-bold text-lg tracking-tight">
              PackSMP<span className="text-primary opacity-80">Ops</span>
            </span>
          </div>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const isActive = location === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors text-sm font-medium ${
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <Button
            variant="ghost"
            className="w-full justify-start text-muted-foreground hover:text-destructive hover:bg-destructive/10"
            onClick={onLogout}
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign Out
          </Button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background pointer-events-none -z-10" />
        <div className="flex-1 overflow-y-auto p-4 md:p-8">
          <div className="max-w-7xl mx-auto space-y-8">{children}</div>
        </div>
      </main>
    </div>
  );
}
