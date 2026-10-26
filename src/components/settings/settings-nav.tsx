"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

// Settings pages, grouped: your own (everyone) and the workspace's (admins).
export const SETTINGS_TABS = [
  { href: "/settings/account", label: "Account", group: "You", adminOnly: false },
  { href: "/settings/ai", label: "AI & MCP", group: "You", adminOnly: false },
  { href: "/settings/members", label: "Members", group: "Workspace", adminOnly: true },
  { href: "/settings/groups", label: "Groups", group: "Workspace", adminOnly: true },
  { href: "/settings/sso", label: "Single sign-on", group: "Workspace", adminOnly: true },
  { href: "/settings/labels", label: "Labels", group: "Workspace", adminOnly: true },
  { href: "/settings/intake", label: "Intake", group: "Workspace", adminOnly: true },
  { href: "/settings/sharing", label: "Sharing", group: "Workspace", adminOnly: true },
  { href: "/settings/notifications", label: "Notifications", group: "Workspace", adminOnly: true },
  { href: "/settings/backup", label: "Backup", group: "Workspace", adminOnly: true },
  { href: "/settings/updates", label: "Updates", group: "Workspace", adminOnly: true, instanceOnly: true },
] as const;

/** Grouped links down the side on wider screens; a single picker on phones, where
 *  eleven tabs don't fit across. */
export function SettingsNav({ isAdmin, isInstanceAdmin }: { isAdmin: boolean; isInstanceAdmin: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const tabs = SETTINGS_TABS.filter((t) => (!t.adminOnly || isAdmin) && (!("instanceOnly" in t) || isInstanceAdmin));
  const active = tabs.find((t) => pathname === t.href || pathname.startsWith(`${t.href}/`));
  const groups = [...new Set(tabs.map((t) => t.group))];

  return (
    <>
      <div className="md:hidden">
        <label htmlFor="settings-section" className="sr-only">Settings section</label>
        <Select id="settings-section" value={active?.href ?? ""} onChange={(e) => router.push(e.target.value)}>
          {groups.map((g) => (
            <optgroup key={g} label={g}>
              {tabs.filter((t) => t.group === g).map((t) => (
                <option key={t.href} value={t.href}>{t.label}</option>
              ))}
            </optgroup>
          ))}
        </Select>
      </div>
      <nav aria-label="Settings" className="hidden flex-col gap-4 md:flex">
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-0.5">
            {groups.length > 1 && <p className="px-3 pb-1 text-xs font-medium text-muted-foreground">{g}</p>}
            {tabs.filter((t) => t.group === g).map((t) => (
              <Link
                key={t.href}
                href={t.href}
                aria-current={t === active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm transition-colors",
                  t === active ? "bg-hover font-medium text-foreground" : "text-muted-foreground hover:bg-hover hover:text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </div>
        ))}
      </nav>
    </>
  );
}
