"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";

import { formatBytes, MAX_ASSET_BYTES } from "@/lib/asset-types";
import { Button } from "@/components/ui/button";

type Job = { name: string; size: number; progress: number; error?: string; done?: boolean };

/** Stream one file to PUT /api/assets with progress. Resolves to the asset id. */
export function uploadAsset(f: File, onProgress: (p: number) => void, replaceId?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (f.size > MAX_ASSET_BYTES) return reject(new Error("Files can be up to 95 MB."));
    if (f.size === 0) return reject(new Error("That file is empty."));
    const xhr = new XMLHttpRequest();
    const qs = `name=${encodeURIComponent(f.name)}${replaceId ? `&replace=${encodeURIComponent(replaceId)}` : ""}`;
    xhr.open("PUT", `/api/assets?${qs}`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let body: { asset?: { id: string }; error?: string } = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status === 200 && body.asset) resolve(body.asset.id);
      else reject(new Error(body.error ?? (xhr.status === 413 ? "Files can be up to 95 MB." : "Upload failed — please try again.")));
    };
    xhr.onerror = () => reject(new Error("Upload failed — check your connection and try again."));
    xhr.send(f);
  });
}

/** "Upload files": pick or drop several at once; they upload one after another. A single
 *  upload opens the new asset so it can be named and labelled. */
export function UploadAssets({ dropTarget = false }: { dropTarget?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [dragging, setDragging] = useState(false);
  const busy = jobs.some((j) => !j.done && !j.error);
  const runRef = useRef<(files: File[]) => void>(() => {});

  // Files dropped anywhere on the page upload to the library.
  useEffect(() => {
    if (!dropTarget) return;
    let depth = 0;
    const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth++;
      setDragging(true);
    };
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault();
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth = 0;
      setDragging(false);
      runRef.current([...(e.dataTransfer?.files ?? [])]);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [dropTarget]);

  async function run(files: File[]) {
    if (!files.length || busy) return;
    const list: Job[] = files.map((f) => ({ name: f.name, size: f.size, progress: 0 }));
    setJobs(list);
    const patch = (i: number, p: Partial<Job>) => setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...p } : j)));
    let lastId: string | null = null;
    let ok = 0;
    for (let i = 0; i < files.length; i++) {
      try {
        lastId = await uploadAsset(files[i], (p) => patch(i, { progress: p }));
        patch(i, { done: true, progress: 1 });
        ok++;
      } catch (e) {
        patch(i, { error: (e as Error).message });
      }
    }
    if (files.length === 1 && ok === 1 && lastId) {
      setJobs([]);
      router.push(`/assets/${lastId}`);
    } else {
      router.refresh();
      if (ok === files.length) setTimeout(() => setJobs([]), 2500);
    }
  }

  useEffect(() => {
    runRef.current = (files) => void run(files);
  });

  return (
    <div className="flex flex-col items-end gap-2">
      <input
        ref={input}
        type="file"
        multiple
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          void run([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
      <Button size="sm" disabled={busy} onClick={() => input.current?.click()}>
        <Upload className="size-4" aria-hidden="true" /> Upload files
      </Button>
      {dropTarget && dragging && (
        <div className="pointer-events-none fixed inset-0 z-40 bg-accent/10 ring-4 ring-inset ring-accent" aria-hidden="true">
          <span className="absolute left-1/2 top-1/3 -translate-x-1/2 rounded-lg bg-surface px-4 py-2 text-sm font-medium shadow">
            Drop to upload to the library
          </span>
        </div>
      )}
      {jobs.length > 0 && (
        <ul role="status" className="w-72 rounded-lg border border-border bg-surface p-2 text-xs shadow-sm">
          {jobs.map((j, i) => (
            <li key={i} className="flex flex-col gap-1 px-1 py-1">
              <div className="flex justify-between gap-2">
                <span className="truncate font-medium">{j.name}</span>
                <span className="shrink-0 text-muted-foreground">{j.error ? "Failed" : j.done ? "Done" : `${Math.round(j.progress * 100)}%`}</span>
              </div>
              {j.error ? (
                <span className="text-destructive-ink">{j.error}</span>
              ) : (
                <span className="h-1 overflow-hidden rounded bg-muted" aria-hidden="true">
                  <span className="block h-full bg-accent transition-[width]" style={{ width: `${j.progress * 100}%` }} />
                </span>
              )}
              <span className="sr-only">{formatBytes(j.size)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
