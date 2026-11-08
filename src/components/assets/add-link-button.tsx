"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";

import { createAssetLink } from "@/app/actions/assets";
import { ASSET_TYPES, ASSET_TYPE_LABEL, type AssetType } from "@/lib/asset-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** "Add a link": for assets that live elsewhere (Drive, Figma, a stock library). */
export function AddLinkButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // onSubmit, not a form action: an action resets the inputs, which would wipe what was
  // typed whenever the link is rejected.
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await createAssetLink({
        name: String(fd.get("name") ?? ""),
        externalUrl: String(fd.get("url") ?? ""),
        assetType: String(fd.get("assetType")) as AssetType,
      });
      if ("error" in res) return setError(res.error ?? "Couldn't add it.");
      setOpen(false);
      router.push(`/assets/${res.id}`);
    });
  }

  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <Link2 className="size-4" aria-hidden="true" /> Add a link
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="top-1/3 max-w-sm rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Link2 className="size-4 text-accent" aria-hidden="true" /> Add a link to the library
          </DialogTitle>
          <DialogDescription className="sr-only">Name an asset that lives somewhere else, and link to it.</DialogDescription>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Input name="name" required autoFocus maxLength={200} placeholder="e.g. Brand photo library" aria-label="Name" />
            <Input name="url" type="url" required maxLength={2000} placeholder="https://" aria-label="Link" />
            <Select name="assetType" defaultValue="other" aria-label="Type">
              {ASSET_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ASSET_TYPE_LABEL[t]}
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
