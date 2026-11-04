"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Library, Plus } from "lucide-react";

import { createContentItem } from "@/app/actions/content";
import { CONTENT_TYPES, CONTENT_TYPE_LABEL } from "@/lib/content";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** "New content": a title and a type, then the item's page to fill in the rest. */
export function NewContentButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await createContentItem({
        title: String(fd.get("title") ?? ""),
        contentType: String(fd.get("contentType")) as (typeof CONTENT_TYPES)[number],
      });
      if ("error" in res) return setError(res.error ?? "Couldn't add it.");
      setOpen(false);
      router.push(`/content/${res.id}`);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" />
        New content
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="top-1/3 max-w-sm rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Library className="size-4 text-accent" aria-hidden="true" /> Add content to the inventory
          </DialogTitle>
          <DialogDescription className="sr-only">Name a piece of content your team has shipped, then add its dates.</DialogDescription>
          <form action={submit} className="flex flex-col gap-3">
            <Input name="title" required autoFocus maxLength={200} placeholder="e.g. Data Privacy Essentials 2026" aria-label="Title" />
            <Select name="contentType" defaultValue="course" aria-label="Type">
              {CONTENT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {CONTENT_TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
            {error && <p className="text-sm text-destructive-ink">{error}</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending}>
                Add
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
