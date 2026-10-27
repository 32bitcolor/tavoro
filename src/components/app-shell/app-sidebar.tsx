"use client";

import { useTransition } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChartColumn, Check, ChevronsUpDown, Gauge, LifeBuoy, LogOut, Settings, Users } from "lucide-react";

import { logout } from "@/app/actions/auth";
import { switchWorkspace } from "@/app/actions/workspace";
import { NAV_MODULES } from "@/lib/modules";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { TavoroMark, TavoroWordmark } from "@/components/shared/brand";

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppSidebar({
  workspaceName,
  userLabel,
  userEmail,
  role,
  isAdmin,
  canViewTeam,
  workspaces = [],
  activeWorkspaceId = null,
}: {
  workspaceName: string;
  userLabel: string;
  userEmail: string;
  role: string;
  isAdmin: boolean;
  canViewTeam: boolean;
  workspaces?: { id: string; name: string }[];
  activeWorkspaceId?: string | null;
}) {
  const pathname = usePathname();
  const [, startTransition] = useTransition();
  const { isMobile, setOpenMobile } = useSidebar();
  const initial = (userLabel || userEmail || "?").charAt(0).toUpperCase();

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <Link href="/dashboard">
                {/* Wrapped: the menu button shrinks any direct <svg> child to icon size. */}
                <span className="flex size-8 shrink-0">
                  <TavoroMark />
                </span>
                <div className="grid flex-1 text-left leading-tight">
                  <TavoroWordmark className="truncate text-base" />
                  <span className="truncate text-xs text-muted-foreground">
                    {workspaceName}
                  </span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Workspace</SidebarGroupLabel>
          <SidebarMenu>
            {NAV_MODULES.map((item) => {
              const active = item.href ? isActive(pathname, item.href) : false;
              return (
                <SidebarMenuItem key={item.key}>
                  {item.href ? (
                    <SidebarMenuButton asChild isActive={active} tooltip={item.name}>
                      <Link href={item.href}>
                        <item.icon />
                        <span>{item.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  ) : (
                    <SidebarMenuButton
                      tooltip={`${item.name} · coming soon`}
                      className="cursor-default opacity-50"
                      aria-disabled
                    >
                      <item.icon />
                      <span>{item.name}</span>
                      <span className="ml-auto text-[10px] text-muted-foreground">
                        Soon
                      </span>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              );
            })}
            {canViewTeam && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive(pathname, "/team")} tooltip="Team">
                  <Link href="/team">
                    <Gauge />
                    <span>Team</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
            {canViewTeam && (
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive(pathname, "/reports")} tooltip="Reports">
                  <Link href="/reports">
                    <ChartColumn />
                    <span>Reports</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            )}
          </SidebarMenu>
        </SidebarGroup>

        <SidebarGroup className="mt-auto">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={isActive(pathname, "/help")}
                tooltip="Help & guides"
              >
                <Link href="/help">
                  <LifeBuoy />
                  <span>Help</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          {isMobile ? (
            // On a touch device the sidebar is a slide-over Sheet. A Radix
            // dropdown nested inside that modal Sheet is unreliable on touch
            // (it can open-and-instantly-dismiss), which left account settings
            // unreachable on phones. Render the account actions as plain
            // sidebar links instead, and close the Sheet on navigation.
            <>
              <SidebarMenuItem>
                <div className="flex items-center gap-2 px-2 py-1.5">
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium">
                    {initial}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium">{userLabel}</span>
                    <span className="truncate text-xs text-muted-foreground">{userEmail}</span>
                  </div>
                </div>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton asChild isActive={isActive(pathname, "/settings/account")}>
                  <Link href="/settings/account" onClick={() => setOpenMobile(false)}>
                    <Settings />
                    <span>Account settings</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
              {isAdmin && (
                <SidebarMenuItem>
                  <SidebarMenuButton asChild isActive={isActive(pathname, "/settings/members")}>
                    <Link href="/settings/members" onClick={() => setOpenMobile(false)}>
                      <Users />
                      <span>Members &amp; groups</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
              {workspaces.length > 1 && (
                <>
                  <SidebarGroupLabel>Workspaces</SidebarGroupLabel>
                  {workspaces.map((w) => (
                    <SidebarMenuItem key={w.id}>
                      <SidebarMenuButton
                        onClick={() => {
                          setOpenMobile(false);
                          startTransition(async () => { await switchWorkspace(w.id); });
                        }}
                      >
                        <Check className={`size-4 ${w.id === activeWorkspaceId ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{w.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </>
              )}
              <SidebarMenuItem>
                <SidebarMenuButton
                  onClick={() => {
                    setOpenMobile(false);
                    startTransition(async () => { await logout(); });
                  }}
                >
                  <LogOut />
                  <span>Sign out</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          ) : (
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton
                  size="lg"
                  className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
                >
                  <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-muted text-sm font-medium">
                    {initial}
                  </div>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate font-medium">{userLabel}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                className="w-(--radix-dropdown-menu-trigger-width) min-w-56"
              >
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col">
                    <span className="truncate text-sm font-medium">{userLabel}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {userEmail}
                    </span>
                    <span className="mt-1 text-xs text-muted-foreground">
                      Role: {role}
                    </span>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/settings/account" className="cursor-pointer">
                    <Settings className="size-4" />
                    Account settings
                  </Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/settings/members" className="cursor-pointer">
                      <Users className="size-4" />
                      Members &amp; groups
                    </Link>
                  </DropdownMenuItem>
                )}
                {workspaces.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs text-muted-foreground">Workspaces</DropdownMenuLabel>
                    {workspaces.map((w) => (
                      <DropdownMenuItem
                        key={w.id}
                        className="cursor-pointer"
                        onSelect={() => startTransition(async () => { await switchWorkspace(w.id); })}
                      >
                        <Check className={`size-4 ${w.id === activeWorkspaceId ? "opacity-100" : "opacity-0"}`} />
                        <span className="truncate">{w.name}</span>
                      </DropdownMenuItem>
                    ))}
                  </>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="cursor-pointer"
                  onSelect={() => startTransition(async () => { await logout(); })}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
          )}
        </SidebarMenu>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}
