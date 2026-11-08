"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

import { BANK_KINDS, BANK_KIND_LABEL } from "@/lib/bank";
import { ASSESSMENT_ITEM_TYPES, ASSESSMENT_ITEM_TYPE_LABEL, BLOOM_LEVELS, BLOOM_LABEL } from "@/lib/methodology";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/** One row of filters; each change rewrites the URL, so a filtered view can be shared. */
export function BankFilters({ labels }: { labels: { id: string; name: string }[] }) {
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
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the bank…" aria-label="Search the bank" className="pl-8" />
      </div>
      <Select className={sel} aria-label="Kind" value={params.get("kind") ?? ""} onChange={(e) => set("kind", e.target.value)}>
        <option value="">Questions and scenarios</option>
        {BANK_KINDS.map((k) => (
          <option key={k} value={k}>
            {BANK_KIND_LABEL[k]}s
          </option>
        ))}
      </Select>
      <Select className={sel} aria-label="Item type" value={params.get("type") ?? ""} onChange={(e) => set("type", e.target.value)}>
        <option value="">Any item type</option>
        {ASSESSMENT_ITEM_TYPES.map((t) => (
          <option key={t} value={t}>
            {ASSESSMENT_ITEM_TYPE_LABEL[t]}
          </option>
        ))}
      </Select>
      <Select className={sel} aria-label="Level" value={params.get("bloom") ?? ""} onChange={(e) => set("bloom", e.target.value)}>
        <option value="">Any level</option>
        {BLOOM_LEVELS.map((b) => (
          <option key={b} value={b}>
            {BLOOM_LABEL[b]}
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
        <option value="1">Not used in any project</option>
      </Select>
      <Select className={sel} aria-label="Archived" value={params.get("archived") ?? ""} onChange={(e) => set("archived", e.target.value)}>
        <option value="">In the bank</option>
        <option value="1">Archived</option>
      </Select>
    </div>
  );
}
