"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { CONTENT_STATUSES, CONTENT_STATUS_LABEL, CONTENT_TYPES, CONTENT_TYPE_LABEL, LIFECYCLE_LABEL, type Lifecycle } from "@/lib/content";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

const LIFECYCLE_FILTERS: Lifecycle[] = ["expired", "review_overdue", "expiring", "review_due", "needs_review", "current", "undated"];

/** One row of filters; each change rewrites the URL, so a filtered view can be shared. */
export function ContentFilters({
  members,
  labels,
  meId,
}: {
  members: { id: string; label: string }[];
  labels: { id: string; name: string }[];
  meId: string;
}) {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [q, setQ] = useState(params.get("q") ?? "");

  function set(key: string, value: string) {
    const sp = new URLSearchParams(params);
    if (value) sp.set(key, value);
    else sp.delete(key);
    router.replace(`${pathname}${sp.size ? `?${sp}` : ""}`, { scroll: false });
  }

  // Search as you type, a beat after the last keystroke.
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => set("q", q.trim()), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const sel = "w-auto min-w-0";
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search content…" aria-label="Search content" className="pl-8" />
      </div>
      <Select className={sel} aria-label="Lifecycle" value={params.get("lifecycle") ?? ""} onChange={(e) => set("lifecycle", e.target.value)}>
        <option value="">Any lifecycle</option>
        <option value="attention">Needs attention</option>
        {LIFECYCLE_FILTERS.map((l) => (
          <option key={l} value={l}>
            {LIFECYCLE_LABEL[l]}
          </option>
        ))}
      </Select>
      <Select className={sel} aria-label="Type" value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">Any type</option>
        {CONTENT_TYPES.map((t) => (
          <option key={t} value={t}>
            {CONTENT_TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      <Select className={sel} aria-label="Status" value={params.get("status") ?? ""} onChange={(e) => set("status", e.target.value)}>
        <option value="">Not retired</option>
        {CONTENT_STATUSES.map((s) => (
          <option key={s} value={s}>
            {CONTENT_STATUS_LABEL[s]}
          </option>
        ))}
        <option value="all">All, incl. retired</option>
      </Select>
      <Select className={sel} aria-label="Owner" value={params.get("owner") ?? ""} onChange={(e) => set("owner", e.target.value)}>
        <option value="">Any owner</option>
        <option value={meId}>Owned by me</option>
        {members
          .filter((m) => m.id !== meId)
          .map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
      </Select>
      {labels.length > 0 && (
        <Select className={sel} aria-label="Label" value={params.get("label") ?? ""} onChange={(e) => set("label", e.target.value)}>
          <option value="">Any label</option>
          {labels.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      )}
    </div>
  );
}
