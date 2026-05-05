import { Link, useLocation } from "wouter";
import {
  LayoutDashboard,
  Plug,
  BarChart3,
  Phone,
  Settings,
  Menu,
  ClipboardList,
  Activity,
  Users,
  FileAudio,
  Headphones,
  ExternalLink,
  Play,
} from "lucide-react";
import { useState } from "react";
import type { LucideIcon } from "lucide-react";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  external?: boolean;
};

type NavSection = {
  label: string;
  items: NavItem[];
};

const navSections: NavSection[] = [
  {
    label: "Overview",
    items: [
      { label: "Dashboard", href: "/", icon: LayoutDashboard },
    ],
  },
  {
    label: "Extraction",
    items: [
      { label: "Contacts", href: "/incontact", icon: Phone },
      { label: "Agents", href: "/agents", icon: Users },
      { label: "Recordings", href: "/recordings", icon: FileAudio },
    ],
  },
  {
    label: "Operations",
    items: [
      { label: "Monitor", href: "/monitor", icon: BarChart3 },
      { label: "Live Monitor", href: "/realtime", icon: Activity, external: true },
      { label: "Daily Job Runs", href: "/runs", icon: Play },
      { label: "Audit Log", href: "/audit", icon: ClipboardList },
    ],
  },
  {
    label: "Tools",
    items: [
      { label: "API Explorer", href: "/incontact", icon: Plug },
      { label: "Scripts", href: "/scripts", icon: Settings },
    ],
  },
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
            <Headphones className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-semibold text-sidebar-foreground">InContact Extractor</h1>
            <p className="text-[10px] text-muted-foreground">Contacts · Agents · Recordings</p>
          </div>
        </div>
        <nav className="p-2 space-y-3">
          {navSections.map((section) => (
            <div key={section.label}>
              <div className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                {section.label}
              </div>
              <div className="space-y-0.5">
                {section.items.map((item) => {
                  const isActive =
                    !item.external &&
                    (location === item.href ||
                      (item.href !== "/" && location.startsWith(item.href)));
                  const className = `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm cursor-pointer transition-colors ${
                    isActive
                      ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  }`;
                  if (item.external) {
                    return (
                      <a
                        key={item.href}
                        href={item.href}
                        className={className}
                        onClick={() => setMobileOpen(false)}
                      >
                        <item.icon className="w-4 h-4" />
                        <span className="flex-1">{item.label}</span>
                        <ExternalLink className="w-3 h-3 opacity-60" />
                      </a>
                    );
                  }
                  return (
                    <Link key={item.href} href={item.href}>
                      <div className={className} onClick={() => setMobileOpen(false)}>
                        <item.icon className="w-4 h-4" />
                        {item.label}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
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
          <span className="ml-3 text-sm font-semibold">InContact Extractor</span>
        </header>
        <main className="flex-1 p-6 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
