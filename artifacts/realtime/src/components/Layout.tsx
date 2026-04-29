import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { 
  Activity, 
  Users, 
  Network, 
  Layers, 
  Phone,
  Settings,
  CircleDot
} from "lucide-react";
import { useSettingsStore } from "@/hooks/use-nice-data";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isPaused } = useSettingsStore();

  const navItems = [
    { href: "/", label: "Overview", icon: Activity },
    { href: "/contacts", label: "Contacts", icon: Phone },
    { href: "/agents", label: "Agents", icon: Users },
    { href: "/skills", label: "Skills", icon: Layers },
    { href: "/teams", label: "Teams", icon: Network },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <aside className="w-full md:w-64 border-r border-border bg-card flex flex-col">
        <div className="p-4 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 bg-primary/20 flex items-center justify-center rounded">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="font-bold text-sm tracking-widest uppercase">NICE Live</h1>
            <p className="text-xs text-muted-foreground">Operations Center</p>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = location === item.href;
            return (
              <Link 
                key={item.href} 
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive 
                    ? "bg-primary/10 text-primary font-medium" 
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                }`}
              >
                <Icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Status</span>
            <div className="flex items-center gap-1.5">
              <CircleDot className={`w-3 h-3 ${isPaused ? "text-amber-500" : "text-emerald-500 animate-pulse-slow"}`} />
              <span className={isPaused ? "text-amber-500" : "text-emerald-500"}>
                {isPaused ? "PAUSED" : "LIVE"}
              </span>
            </div>
          </div>
        </div>
      </aside>
      
      <main className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 h-full">
          {children}
        </div>
      </main>
    </div>
  );
}
