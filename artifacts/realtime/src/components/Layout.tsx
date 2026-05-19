import { ReactNode, useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import {
  Activity,
  Users,
  Network,
  Layers,
  Phone,
  Settings,
  CircleDot,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  Code2,
} from "lucide-react";
import { useSettingsStore } from "@/hooks/use-nice-data";

const COLLAPSED_KEY = "nice-live:sidebar-collapsed";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { isPaused } = useSettingsStore();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  });

  useEffect(() => {
    window.localStorage.setItem(COLLAPSED_KEY, collapsed ? "1" : "0");
  }, [collapsed]);

  const navGroups: {
    label: string | null;
    icon?: typeof Activity;
    items: { href: string; label: string; icon: typeof Activity }[];
  }[] = [
    {
      label: null,
      items: [
        { href: "/", label: "Overview", icon: Activity },
        { href: "/contacts", label: "Contacts", icon: Phone },
        { href: "/agents", label: "Agents", icon: Users },
        { href: "/skills", label: "Skills", icon: Layers },
        { href: "/teams", label: "Teams", icon: Network },
        { href: "/settings", label: "Settings", icon: Settings },
      ],
    },
    {
      label: "Reference",
      icon: BookOpen,
      items: [
        { href: "/reference/incontact-api", label: "InContact API", icon: Code2 },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col md:flex-row">
      <aside
        className={`w-full border-r border-border bg-card flex flex-col transition-[width] duration-200 ${
          collapsed ? "md:w-16" : "md:w-64"
        }`}
      >
        <div
          className={`border-b border-border flex items-center ${
            collapsed ? "p-3 md:justify-center" : "p-4 gap-3"
          }`}
        >
          <div className="w-8 h-8 bg-primary/20 flex items-center justify-center rounded shrink-0">
            <Activity className="w-5 h-5 text-primary" />
          </div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <h1 className="font-bold text-sm tracking-widest uppercase">NICE Live</h1>
              <p className="text-xs text-muted-foreground">Operations Center</p>
            </div>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            className={`hidden md:inline-flex items-center justify-center w-7 h-7 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors ${
              collapsed ? "mt-2" : ""
            }`}
          >
            {collapsed ? (
              <PanelLeftOpen className="w-4 h-4" />
            ) : (
              <PanelLeftClose className="w-4 h-4" />
            )}
          </button>
        </div>

        <nav className={`flex-1 space-y-4 ${collapsed ? "p-2" : "p-4"}`}>
          {navGroups.map((group, gi) => {
            const GroupIcon = group.icon;
            return (
              <div key={gi} className="space-y-1">
                {group.label && (
                  collapsed ? (
                    <div
                      className="flex justify-center py-1 text-muted-foreground/60"
                      title={group.label}
                    >
                      {GroupIcon && <GroupIcon className="w-3.5 h-3.5" />}
                    </div>
                  ) : (
                    <div className="px-3 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70 flex items-center gap-1.5">
                      {GroupIcon && <GroupIcon className="w-3 h-3" />}
                      {group.label}
                    </div>
                  )
                )}
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = location === item.href;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center rounded-md text-sm transition-colors ${
                        collapsed ? "justify-center px-2 py-2" : "gap-3 px-3 py-2"
                      } ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground"
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      {!collapsed && <span>{item.label}</span>}
                    </Link>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className={`border-t border-border ${collapsed ? "p-2" : "p-4"}`}>
          {collapsed ? (
            <div
              className="flex justify-center"
              title={isPaused ? "PAUSED" : "LIVE"}
            >
              <CircleDot
                className={`w-4 h-4 ${
                  isPaused ? "text-amber-500" : "text-emerald-500 animate-pulse-slow"
                }`}
              />
            </div>
          ) : (
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Status</span>
              <div className="flex items-center gap-1.5">
                <CircleDot
                  className={`w-3 h-3 ${
                    isPaused ? "text-amber-500" : "text-emerald-500 animate-pulse-slow"
                  }`}
                />
                <span className={isPaused ? "text-amber-500" : "text-emerald-500"}>
                  {isPaused ? "PAUSED" : "LIVE"}
                </span>
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 overflow-auto bg-background/50">
        <div className="p-6 h-full">{children}</div>
      </main>
    </div>
  );
}
