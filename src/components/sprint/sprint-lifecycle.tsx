"use client";

import { useState } from "react";
import { CheckCircle2, Play } from "lucide-react";

import { completeSprint, getSprintCompletion, startSprint } from "@/app/actions/backlog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatEstimate, type EstimateUnit } from "@/lib/card-fields";

// Start sprint / Complete sprint, shared by the Backlog and the Sprints page.

function isoDay(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function StartSprintButton({
  sprint,
  cardCount,
  estimate,
  estimateUnit,
  onStarted,
  size = "sm",
}: {
  sprint: { id: string; name: string; goal: string | null; startDate: string | null; endDate: string | null };
  cardCount: number;
  estimate: number;
  estimateUnit: EstimateUnit;
  onStarted: (s: { name: string; goal: string | null; startDate: string; endDate: string }) => void;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(sprint.name);
  const [goal, setGoal] = useState(sprint.goal ?? "");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function onOpenChange(v: boolean) {
    setOpen(v);
    if (!v) return;
    // Defaults: today, for two weeks (inclusive), unless the sprint already has dates.
    const today = new Date();
    const twoWeeks = new Date(today);
    twoWeeks.setDate(today.getDate() + 13);
    setName(sprint.name);
    setGoal(sprint.goal ?? "");
    setStart(sprint.startDate ?? isoDay(today));
    setEnd(sprint.endDate ?? isoDay(twoWeeks));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await startSprint(sprint.id, { name, goal, startDate: start, endDate: end });
    setBusy(false);
    if ("error" in res) {
      setError(res.error ?? "Couldn’t start the sprint.");
      return;
    }
    setOpen(false);
    onStarted({ name: name.trim(), goal: goal.trim() || null, startDate: start, endDate: end });
  }

  return (
    <>
      <Button size={size} variant="outline" onClick={() => onOpenChange(true)}>
        <Play className="size-3.5" aria-hidden="true" />
        Start sprint
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Start sprint</DialogTitle>
              <DialogDescription>
                {cardCount} {cardCount === 1 ? "card" : "cards"}
                {estimate > 0 && <> · {formatEstimate(estimate, estimateUnit)}</>} will be in this sprint when it starts.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="start-sprint-name">Name</Label>
              <Input id="start-sprint-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start-sprint-start">Start date</Label>
                <Input id="start-sprint-start" type="date" value={start} onChange={(e) => setStart(e.target.value)} required />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="start-sprint-end">End date</Label>
                <Input id="start-sprint-end" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} required />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="start-sprint-goal">Sprint goal</Label>
              <Textarea id="start-sprint-goal" value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={500} rows={3} placeholder="What should this sprint achieve?" />
            </div>
            {error && (
              <p role="alert" className="text-sm text-destructive-ink">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy}>
                {busy ? "Starting…" : "Start sprint"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

type Completion = Exclude<Awaited<ReturnType<typeof getSprintCompletion>>, { error: string }>;

export function CompleteSprintButton({
  sprintId,
  estimateUnit,
  onCompleted,
  size = "sm",
}: {
  sprintId: string;
  estimateUnit: EstimateUnit;
  /** movedTo: the sprint the unfinished cards went to (null = the backlog); `created` when it's new. */
  onCompleted: (r: { movedTo: { id: string; name: string } | null; created: boolean }) => void;
  size?: "sm" | "xs";
}) {
  const [open, setOpen] = useState(false);
  const [info, setInfo] = useState<Completion | null>(null);
  const [moveTo, setMoveTo] = useState("backlog");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onOpenChange(v: boolean) {
    setOpen(v);
    if (!v) return;
    setInfo(null);
    setError(null);
    const res = await getSprintCompletion(sprintId);
    if ("error" in res) {
      setError(res.error ?? "Couldn’t load the sprint.");
      return;
    }
    setInfo(res);
    setMoveTo(res.plannedSprints[0]?.id ?? "backlog");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await completeSprint(sprintId, moveTo);
    setBusy(false);
    if ("error" in res) {
      setError(res.error ?? "Couldn’t complete the sprint.");
      return;
    }
    setOpen(false);
    onCompleted({ movedTo: res.movedTo, created: moveTo === "new" });
  }

  const est = (n: number) => (n > 0 ? ` · ${formatEstimate(n, estimateUnit)}` : "");

  return (
    <>
      <Button size={size} variant="outline" onClick={() => onOpenChange(true)}>
        <CheckCircle2 className="size-3.5" aria-hidden="true" />
        Complete sprint
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={submit} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>Complete {info?.sprint.name ?? "sprint"}</DialogTitle>
              <DialogDescription>Done cards stay with this sprint. Choose where the unfinished ones go.</DialogDescription>
            </DialogHeader>
            {info ? (
              <>
                <ul className="flex flex-col gap-1 text-sm">
                  <li>
                    <span className="font-semibold">{info.done.count}</span> {info.done.count === 1 ? "card" : "cards"} done{est(info.done.estimate)}
                  </li>
                  <li>
                    <span className="font-semibold">{info.notDone.count}</span> {info.notDone.count === 1 ? "card" : "cards"} not done
                    {est(info.notDone.estimate)}
                  </li>
                </ul>
                {info.notDone.count > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="complete-sprint-move">Move unfinished cards to</Label>
                    <Select id="complete-sprint-move" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                      {info.plannedSprints.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                      <option value="new">New sprint ({info.newSprintName})</option>
                      <option value="backlog">Backlog</option>
                    </Select>
                  </div>
                )}
              </>
            ) : (
              !error && <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive-ink">
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !info}>
                {busy ? "Completing…" : "Complete sprint"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
