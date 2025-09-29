"use client";

import { Bell, FolderOpen, Home, MessageSquare, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useDueNowCount } from "@/hooks/use-due-now-count";
import { cn } from "@/lib/utils";

export type MobileTab = "chat" | "folders" | "settings";

interface MobileTabBarProps {
  activeTab: MobileTab;
  onTabChange: (tab: MobileTab) => void;
  onChatToggle: () => void;
  onFoldersToggle: () => void;
}

export function MobileTabBar({
  activeTab,
  onTabChange,
  onChatToggle,
  onFoldersToggle,
}: MobileTabBarProps) {
  const pathname = usePathname();
  const { count: dueNowCount } = useDueNowCount();

  const handleTabClick = (tab: MobileTab) => {
    onTabChange(tab);

    if (tab === "chat") {
      onChatToggle();
    } else if (tab === "folders") {
      onFoldersToggle();
    }
  };

  const tabs = [
    {
      id: "chat" as MobileTab,
      label: "Chat",
      icon: MessageSquare,
      onClick: () => handleTabClick("chat"),
    },
    {
      id: "folders" as MobileTab,
      label: "Lists",
      icon: FolderOpen,
      onClick: () => handleTabClick("folders"),
    },
    {
      id: "settings" as MobileTab,
      label: "Settings",
      icon: Settings,
      href: "/settings",
    },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 bg-background border-t border-border md:hidden"
      role="tablist"
      aria-label="Main navigation"
    >
      <div className="flex items-center justify-around px-2 py-2 safe-area-pb">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          const hasNotification = "badge" in tab && tab.badge;

          if ("href" in tab && tab.href) {
            return (
              <Link
                key={tab.id}
                href={tab.href}
                role="tab"
                aria-selected={isActive}
                aria-label={`${tab.label} tab`}
                className={cn(
                  "flex flex-col items-center justify-center min-w-0 flex-1 px-2 py-2 rounded-lg transition-colors",
                  isActive
                    ? "text-primary bg-primary/10"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted",
                )}
                onClick={() => onTabChange(tab.id)}
              >
                <div className="relative">
                  <Icon className="h-5 w-5 mb-1" />
                  {hasNotification && "badge" in tab && (
                    <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-medium">
                      {tab.badge && tab.badge > 99 ? "99+" : tab.badge}
                    </span>
                  )}
                </div>
                <span className="text-xs font-medium truncate">
                  {tab.label}
                </span>
              </Link>
            );
          }

          return (
            <button
              key={tab.id}
              onClick={"onClick" in tab ? tab.onClick : undefined}
              role="tab"
              aria-selected={isActive}
              aria-label={`${tab.label} tab`}
              className={cn(
                "flex flex-col items-center justify-center min-w-0 flex-1 px-2 py-2 rounded-lg transition-colors",
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
            >
              <div className="relative">
                <Icon className="h-5 w-5 mb-1" />
                {hasNotification && "badge" in tab && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[10px] flex items-center justify-center font-medium">
                    {tab.badge && tab.badge > 99 ? "99+" : tab.badge}
                  </span>
                )}
              </div>
              <span className="text-xs font-medium truncate">{tab.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
