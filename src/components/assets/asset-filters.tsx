"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { ASSET_TYPES, ASSET_TYPE_LABEL } from "@/lib/asset-types";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** One row of filters; each change rewrites the URL, so a filtered view can be shared. */
export function AssetFilters({ labels }: { labels: { id: string; name: string }[] }) {
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search assets…" aria-label="Search assets" className="pl-8" />
      </div>
      <Select className={sel} aria-label="Type" value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">Any type</option>
        {ASSET_TYPES.map((t) => (
          <option key={t} value={t}>
            {ASSET_TYPE_LABEL[t]}
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
      <Select className={sel} aria-label="Use" value={params.get("unused") ?? ""} onChange={(e) => set("unused", e.target.value)}>
        <option value="">Used or not</option>
        <option value="1">Not used in any content</option>
      </Select>
      <Select className={sel} aria-label="Archived" value={params.get("archived") ?? ""} onChange={(e) => set("archived", e.target.value)}>
        <option value="">In the library</option>
        <option value="1">Archived</option>
      </Select>
    </div>
  );
}
