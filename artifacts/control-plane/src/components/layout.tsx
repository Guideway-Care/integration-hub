import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Server,
  Plug,
  Play,
  Calendar,
  BarChart3,
  Phone,
  Database,
  FileCode,
  Settings,
  Menu,
  X,
  ClipboardList,
  Download,
} from "lucide-react";
import { useState } from "react";

const navItems = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Source Systems", href: "/source-systems", icon: Server },
  { label: "Endpoints", href: "/endpoints", icon: Plug },
  { label: "Runs", href: "/runs", icon: Play },
  { label: "InContact", href: "/incontact", icon: Phone },
  { label: "Monitor", href: "/monitor", icon: BarChart3 },
  { label: "Audit Log", href: "/audit", icon: ClipboardList },
  { label: "Scripts", href: "/scripts", icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background flex">
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-64 bg-sidebar border-r border-sidebar-border transform transition-transform lg:translate-x-0 lg:static ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center gap-2 px-4 h-14 border-b border-sidebar-border">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
            <Plug className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">API Controller Hub</h1>
            <p className="text-[10px] text-muted-foreground">Integration Platform</p>
          </div>
        </div>
        <nav className="p-2 space-y-0.5">
          {navItems.map((item) => {
            const isActive =
              location === item.href ||
              (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link key={item.href} href={item.href}>
                <div
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`}
                  onClick={() => setMobileOpen(false)}
                >
                  <item.icon className="w-4 h-4" />
                  {item.label}
                </div>
              </Link>
            );
          })}
        </nav>
      </aside>

      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className="flex-1 flex flex-col min-h-screen">
        <header className="h-14 border-b border-border flex items-center px-4 lg:hidden">
          <button onClick={() => setMobileOpen(true)}>
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-3 text-sm font-semibold">API Controller Hub</span>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
