"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BookCheck, Plus } from "lucide-react";

import { createBankItem } from "@/app/actions/bank";
import { BANK_KINDS, BANK_KIND_LABEL, BANK_PROMPT_MAX, type BankKind } from "@/lib/bank";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";

/** "New item": the stem and whether it's a question or a scenario; the rest on its page. */
export function NewBankItemButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    setError(null);
    start(async () => {
      const res = await createBankItem({ prompt: String(fd.get("prompt") ?? ""), kind: String(fd.get("kind")) as BankKind });
      if ("error" in res) return setError(res.error ?? "Couldn't add it.");
      setOpen(false);
      router.push(`/bank/${res.id}`);
    });
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <Plus className="size-4" aria-hidden="true" /> New item
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent showCloseButton={false} className="top-1/3 max-w-md rounded-xl bg-surface p-5 shadow-2xl">
          <DialogTitle className="mb-3 flex items-center gap-2 text-sm font-medium">
            <BookCheck className="size-4 text-accent" aria-hidden="true" /> Add to the question bank
          </DialogTitle>
          <DialogDescription className="sr-only">Write a question stem or scenario to reuse across projects.</DialogDescription>
          <form onSubmit={submit} className="flex flex-col gap-3">
            <Textarea
              name="prompt"
              required
              autoFocus
              rows={3}
              maxLength={BANK_PROMPT_MAX}
              placeholder="e.g. A colleague asks for a patient's test results over the phone. What do you do first?"
              aria-label="Question or scenario"
            />
            <Select name="kind" defaultValue="question" aria-label="Kind">
              {BANK_KINDS.map((k) => (
                <option key={k} value={k}>
                  {BANK_KIND_LABEL[k]}
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
