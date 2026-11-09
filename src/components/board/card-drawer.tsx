"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { X, Check, MessageSquare, Paperclip, ArrowUp, ChevronUp, ChevronDown, Globe, Lock, Eye } from "lucide-react";
import { createWhiteboardForCard } from "@/app/actions/whiteboards";
import {
  getCardDetail,
  updateCardDescription,
  setCardDueDate,
  createLabel,
  toggleCardLabel,
  toggleCardAssignee,
  toggleCardSme,
  addSubtask,
  toggleSubtask,
  deleteSubtask,
  addComment,
  deleteComment,
  setCardType,
  setCardPriority,
  setCardEstimate,
  setWatching,
  getCardHistory,
} from "@/app/actions/cards";
import { renameCard, deleteCard } from "@/app/actions/boards";
import {
  deleteAttachment,
} from "@/app/actions/attachments";
import { DescriptionEditor } from "@/components/board/description-editor";
import { CommentComposer, CommentBody } from "@/components/board/comment-editor";
import { assignCardToSprint } from "@/app/actions/sprints";
import { CARD_TYPES, CARD_TYPE_LABEL, PRIORITIES, PRIORITY_LABEL, type CardType, type EstimateUnit, type Priority } from "@/lib/card-fields";
import { PriorityIcon, TypeIcon } from "@/components/shared/card-fields";
import { EpicCardsSection, EpicField, type EpicChip } from "@/components/board/epic-panels";
import { CardLinksSection } from "@/components/board/card-links-section";
import type { EpicRef } from "@/lib/epics";
import { setCardPrivate } from "@/app/actions/board-share";
import { MoveCardDialog, type MoveResult } from "@/components/board/move-card-dialog";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { CardReviewFeedback, type CardReviewComment } from "@/components/review/card-review-feedback";
import { StatusBadge } from "@/components/shared/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { LABEL_PALETTE as PALETTE } from "@/lib/label-colors";
import { dueMeta, dueToneClass } from "@/lib/due";
import { LocalTime } from "@/components/shared/local-time";

export type LabelT = { id: string; name: string; color: string };
export type MemberT = { id: string; name: string | null; email: string };
type SubtaskT = {
  id: string; title: string; done: boolean; dueDate: string | null; keySeq: number | null;
  assigneeIds: string[]; commentCount: number; attachmentCount: number;
};
type AttachmentT = { id: string; fileName: string; mimeType: string; sizeBytes: number; createdAt: string };
type WhiteboardT = { id: string; title: string };
type CommentT = {
  id: string;
  body: string;
  createdAt: string;
  author: { id: string; name: string | null; email: string };
};
export type CardFacePatch = {
  title?: string;
  dueDate?: string | null;
  labels?: LabelT[];
  assignees?: { id: string; name: string | null; email: string }[];
  smes?: { id: string; name: string | null; email: string }[];
  checklist?: { total: number; done: number };
  private?: boolean;
  type?: CardType;
  priority?: Priority | null;
  estimate?: number | null;
  epic?: EpicChip | null;
  epicProgress?: { done: number; total: number };
  blocked?: boolean;
  /** The card's sprint changed from the panel (the Backlog moves it between sections). */
  sprintId?: string | null;
  comments?: number;
  attachments?: number;
};

export function CardDrawer({
  cardId,
  onClose,
  onPatch,
  onDeleted,
  onNavigate,
  columns,
  currentColumnId,
  onMoveToColumn,
  position,
  onStep,
  onMoved,
}: {
  cardId: string;
  onClose: () => void;
  onPatch: (cardId: string, patch: CardFacePatch) => void;
  onDeleted: (cardId: string) => void;
  onNavigate?: (cardId: string) => void;
  /** The board's columns + this card's, for the Status picker (a non-drag move). */
  columns?: { id: string; name: string }[];
  currentColumnId?: string | null;
  onMoveToColumn?: (columnId: string) => void;
  /** Where this card sits among the board's visible cards, for previous/next. */
  position?: { index: number; total: number } | null;
  onStep?: (dir: -1 | 1) => void;
  /** Offered "Move to board…"; called after the card moved to another board. */
  onMoved?: (cardId: string, result: MoveResult) => void;
}) {
  // Loading is derived, not a separate state: we're "loading" whenever the data
  // we hold isn't for the card currently open. This flips synchronously when
  // cardId changes (no setState-in-effect) and back once the fetch resolves.
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== cardId;
  const [boardId, setBoardId] = useState("");
  const [cardKeyPrefix, setCardKeyPrefix] = useState<string | null>(null);
  const [keySeq, setKeySeq] = useState<number | null>(null);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState<string | null>(null);
  const [dueDate, setDueDate] = useState<string | null>(null); // ISO
  const [labelIds, setLabelIds] = useState<Set<string>>(new Set());
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());
  const [smeIds, setSmeIds] = useState<Set<string>>(new Set());
  const [sprintId, setSprintId] = useState<string | null>(null);
  const [isPrivate, setIsPrivate] = useState(false);
  const [cardType, setCardTypeState] = useState<CardType>("task");
  const [priority, setPriority] = useState<Priority | null>(null);
  const [estimate, setEstimate] = useState<number | null>(null);
  const [estimateDraft, setEstimateDraft] = useState("");
  const [estimateError, setEstimateError] = useState<string | null>(null);
  const [estimateUnit, setEstimateUnit] = useState<EstimateUnit>("points");
  const [epic, setEpic] = useState<EpicRef | null>(null);
  const [epicCount, setEpicCount] = useState(0);
  const [pendingType, setPendingType] = useState<CardType | null>(null);
  const [typeNote, setTypeNote] = useState<string | null>(null);
  const [watching, setWatchingState] = useState(false);
  const [watcherCount, setWatcherCount] = useState(0);
  const [activityTab, setActivityTab] = useState<"comments" | "history">("comments");
  const [history, setHistory] = useState<{ id: string; actor: string; text: string; at: string }[] | null>(null);
  const [statusId, setStatusId] = useState<string | null>(null);
  const [sprints, setSprints] = useState<{ id: string; name: string }[]>([]);
  const [sprintsEnabled, setSprintsEnabled] = useState(false);
  const [workspaceLabels, setWorkspaceLabels] = useState<LabelT[]>([]);
  const [members, setMembers] = useState<MemberT[]>([]);
  const [mentionable, setMentionable] = useState<MemberT[]>([]);
  const [newLabelName, setNewLabelName] = useState("");
  const [newLabelColor, setNewLabelColor] = useState(PALETTE[4]);
  const [subtasks, setSubtasks] = useState<SubtaskT[]>([]);
  const [isSubtask, setIsSubtask] = useState(false);
  const [parent, setParent] = useState<{ id: string; title: string } | null>(null);
  const [comments, setComments] = useState<CommentT[]>([]);
  const [attachments, setAttachments] = useState<AttachmentT[]>([]);
  const [whiteboards, setWhiteboards] = useState<WhiteboardT[]>([]);
  const [reviewFeedback, setReviewFeedback] = useState<CardReviewComment[]>([]);
  const [cardDone, setCardDone] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);

  useEffect(() => {
    let active = true;
    getCardDetail(cardId).then((d) => {
      if (!active || !d) return;
      setBoardId(d.boardId);
      setCardKeyPrefix(d.boardCardKeyPrefix);
      setKeySeq(d.card.keySeq);
      setTitle(d.card.title);
      setDescription(d.card.description);
      setDueDate(d.card.dueDate);
      setLabelIds(new Set(d.card.labelIds));
      setAssigneeIds(new Set(d.card.assigneeIds));
      setSmeIds(new Set(d.card.smeIds));
      setSprintId(d.card.sprintId);
      setIsPrivate(d.card.private);
      setCardTypeState(d.card.type);
      setPriority(d.card.priority);
      setEstimate(d.card.estimate);
      setEstimateDraft(d.card.estimate == null ? "" : String(d.card.estimate));
      setEstimateError(null);
      setEstimateUnit(d.estimateUnit);
      setEpic(d.card.epic);
      setWatchingState(d.watching);
      setWatcherCount(d.watcherCount);
      setActivityTab("comments");
      setHistory(null);
      setEpicCount(0);
      setPendingType(null);
      setTypeNote(null);
      setStatusId(d.card.statusId);
      setSprints(d.sprints);
      setSprintsEnabled(d.sprintsEnabled);
      setWorkspaceLabels(d.workspaceLabels);
      setMembers(d.members);
      setMentionable(d.mentionable);
      setSubtasks(d.subtasks);
      setIsSubtask(d.isSubtask);
      setParent(d.parent);
      setComments(d.comments);
      setAttachments(d.attachments);
      setWhiteboards(d.whiteboards);
      setReviewFeedback(d.reviewFeedback);
      setCardDone(d.cardDone);
      setCurrentUserId(d.currentUserId);
      setIsAdmin(d.isAdmin);
      setLoadedFor(cardId);
    });
    return () => {
      active = false;
    };
  }, [cardId]);

  function saveTitle() {
    const t = title.trim();
    if (!t) return;
    renameCard(cardId, t);
    onPatch(cardId, { title: t });
  }

  function copyShortLink() {
    if (!cardKeyPrefix || keySeq == null) return;
    const url = `${window.location.origin}/c/${cardKeyPrefix}-${keySeq}`;
    navigator.clipboard.writeText(url).then(() => {
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    });
  }

  function saveDescription(json: string | null) {
    setDescription(json);
    updateCardDescription(cardId, json);
  }

  function togglePrivate() {
    const next = !isPrivate;
    setIsPrivate(next);
    onPatch(cardId, { private: next });
    setCardPrivate(cardId, next).then((res) => {
      if (res && "error" in res) {
        setIsPrivate(!next);
        onPatch(cardId, { private: !next });
      }
    });
  }

  function changeType(next: CardType, confirmed = false) {
    const prev = cardType;
    if (next === prev) return;
    // Turning an epic with cards into something else lets those cards go: ask first.
    if (prev === "epic" && epicCount > 0 && !confirmed) {
      setPendingType(next);
      return;
    }
    setPendingType(null);
    setTypeNote(null);
    setCardTypeState(next);
    onPatch(cardId, { type: next, ...(next === "epic" ? { epic: null } : {}) });
    setCardType(cardId, next).then((res) => {
      if (res && "error" in res) {
        setCardTypeState(prev);
        onPatch(cardId, { type: prev });
        return;
      }
      if (res.sprintId === null) setSprintId(null);
      if (next === "epic") setEpic(null);
      if (res.released > 0) {
        setEpicCount(0);
        setTypeNote(`${res.released} ${res.released === 1 ? "card was" : "cards were"} taken out of this epic.`);
      }
    });
  }

  function changePriority(next: Priority | null) {
    const prev = priority;
    setPriority(next);
    onPatch(cardId, { priority: next });
    setCardPriority(cardId, next).then((res) => {
      if (res && "error" in res) {
        setPriority(prev);
        onPatch(cardId, { priority: prev });
      }
    });
  }

  function saveEstimate() {
    const raw = estimateDraft.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 10000)) {
      setEstimateError("Enter a number from 0 to 10,000.");
      return;
    }
    setEstimateError(null);
    if (next === estimate) return;
    const prev = estimate;
    setEstimate(next);
    onPatch(cardId, { estimate: next });
    setCardEstimate(cardId, next).then((res) => {
      if (res && "error" in res) {
        setEstimate(prev);
        setEstimateDraft(prev == null ? "" : String(prev));
        setEstimateError(res.error ?? "Couldn\u2019t save the estimate.");
        onPatch(cardId, { estimate: prev });
      } else if (res && "estimate" in res) {
        setEstimateDraft(res.estimate == null ? "" : String(res.estimate));
      }
    });
  }

  async function toggleWatching() {
    const next = !watching;
    setWatchingState(next);
    setWatcherCount((n) => n + (next ? 1 : -1));
    const res = await setWatching(cardId, next);
    if ("error" in res) {
      setWatchingState(!next);
      setWatcherCount((n) => n + (next ? -1 : 1));
    } else {
      setWatcherCount(res.watcherCount);
    }
  }

  async function showHistory() {
    setActivityTab("history");
    const r = await getCardHistory(cardId);
    setHistory(r.entries);
  }

  function changeDueDate(value: string) {
    const iso = value ? new Date(value).toISOString() : null;
    setDueDate(iso);
    setCardDueDate(cardId, iso);
    onPatch(cardId, { dueDate: iso });
  }

  function patchLabelsFace(nextIds: Set<string>) {
    onPatch(cardId, { labels: workspaceLabels.filter((l) => nextIds.has(l.id)) });
  }

  function toggleLabel(label: LabelT) {
    const on = !labelIds.has(label.id);
    const next = new Set(labelIds);
    if (on) next.add(label.id);
    else next.delete(label.id);
    setLabelIds(next);
    toggleCardLabel(cardId, label.id, on);
    patchLabelsFace(next);
  }

  async function addLabel() {
    const name = newLabelName.trim();
    if (!name || !boardId) return;
    const res = await createLabel(boardId, name, newLabelColor);
    if (!("label" in res) || !res.label) return;
    const label = res.label;
    setNewLabelName("");
    // Labels are workspace-wide, so this may be one that already exists (created on
    // another board). Don't double-list it — and apply it to the card either way,
    // since typing a name and hitting add means "put this label on this card".
    setWorkspaceLabels((prev) =>
      prev.some((l) => l.id === label.id)
        ? prev
        : [...prev, label].sort((a, b) => a.name.localeCompare(b.name)),
    );
    if (!labelIds.has(label.id)) toggleLabel(label);
  }

  function toggleAssignee(m: MemberT) {
    const on = !assigneeIds.has(m.id);
    const next = new Set(assigneeIds);
    if (on) next.add(m.id);
    else next.delete(m.id);
    setAssigneeIds(next);
    toggleCardAssignee(cardId, m.id, on);
    onPatch(cardId, { assignees: members.filter((x) => next.has(x.id)) });
  }

  function toggleSme(m: MemberT) {
    const on = !smeIds.has(m.id);
    const next = new Set(smeIds);
    if (on) next.add(m.id);
    else next.delete(m.id);
    setSmeIds(next);
    toggleCardSme(cardId, m.id, on);
    onPatch(cardId, { smes: members.filter((x) => next.has(x.id)) });
  }

  function patchSubtasksFace(items: SubtaskT[]) {
    onPatch(cardId, { checklist: { total: items.length, done: items.filter((i) => i.done).length } });
  }

  async function addItem(title: string) {
    const res = await addSubtask(cardId, title);
    if ("item" in res && res.item) {
      const next = [...subtasks, res.item];
      setSubtasks(next);
      patchSubtasksFace(next);
    }
  }

  function toggleItem(item: SubtaskT) {
    const next = subtasks.map((i) => (i.id === item.id ? { ...i, done: !i.done } : i));
    setSubtasks(next);
    toggleSubtask(item.id, !item.done);
    patchSubtasksFace(next);
  }

  async function removeItem(item: SubtaskT) {
    const prev = subtasks;
    const next = subtasks.filter((i) => i.id !== item.id);
    setSubtasks(next);
    patchSubtasksFace(next);
    // Revert if the server rejects, so the row doesn't vanish then reappear on reload.
    const res = await deleteSubtask(item.id);
    if (res?.error) {
      setSubtasks(prev);
      patchSubtasksFace(prev);
    }
  }

  async function postComment(body: string) {
    const res = await addComment(cardId, body);
    if ("comment" in res && res.comment) {
      const next = [...comments, res.comment];
      setComments(next);
      onPatch(cardId, { comments: next.length });
      if (!watching) {
        setWatchingState(true);
        setWatcherCount((n) => n + 1);
      }
    }
  }

  async function removeComment(c: CommentT) {
    const prev = comments;
    const next = comments.filter((x) => x.id !== c.id);
    setComments(next);
    onPatch(cardId, { comments: next.length });
    const res = await deleteComment(c.id);
    if (res?.error) {
      setComments(prev);
      onPatch(cardId, { comments: prev.length });
    }
  }

  async function handleFile(file: File) {
    setUploadError(null);
    if (file.size > 25 * 1024 * 1024) {
      setUploadError("File exceeds the 25 MB limit.");
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("cardId", cardId);
      form.append("file", file);
      const res = await fetch("/api/attachments/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.error) {
        setUploadError(data.error ?? "Upload failed.");
        return;
      }
      if (data.attachment) {
        const next = [...attachments, data.attachment];
        setAttachments(next);
        onPatch(cardId, { attachments: next.length });
      }
    } catch {
      setUploadError("Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function downloadAttachment(a: AttachmentT) {
    window.open(`/api/attachments/${a.id}/download`, "_blank");
  }

  async function removeAttachment(a: AttachmentT) {
    // Deleting an uploaded file is unrecoverable, so remove only once the server
    // confirms; the return value flows to ConfirmDelete to surface any error.
    const res = await deleteAttachment(a.id);
    if (res?.error) return res;
    const next = attachments.filter((x) => x.id !== a.id);
    setAttachments(next);
    onPatch(cardId, { attachments: next.length });
  }

  function handleDelete() {
    deleteCard(cardId);
    onDeleted(cardId);
    onClose();
  }

  const doneCount = subtasks.filter((i) => i.done).length;
  const canPrev = !!position && position.index > 0;
  const canNext = !!position && position.index < position.total - 1;

  // J / K step through the board's visible cards, unless the user is typing.
  useEffect(() => {
    if (!onStep) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.key === "j" && canNext) {
        e.preventDefault();
        onStep!(1);
      } else if (e.key === "k" && canPrev) {
        e.preventDefault();
        onStep!(-1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStep, canNext, canPrev]);

  return (
    // Non-modal side panel: the board stays live beside it, so clicking another
    // card swaps the panel in place instead of closing it (triage without the
    // open-close-open loop of a modal). Escape or the close button dismisses it.
    <Sheet open modal={false} onOpenChange={(v) => !v && onClose()}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="w-full gap-0 overflow-hidden bg-surface p-0 shadow-xl sm:max-w-xl"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >
        <SheetHeader className="flex-row items-start justify-between gap-2 space-y-0 border-b border-border px-4 py-3">
          <SheetTitle asChild>
            <div className="min-w-0 flex-1">
              {cardKeyPrefix && keySeq != null && (
                <button
                  type="button"
                  onClick={copyShortLink}
                  title="Copy shareable link"
                  className="block px-1 font-mono text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                >
                  {cardKeyPrefix}-{keySeq}
                  {linkCopied ? " · Copied!" : ""}
                </button>
              )}
              <textarea
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={saveTitle}
                rows={1}
                aria-label="Card title"
                className="field-sizing-content min-h-[2rem] w-full resize-none rounded bg-transparent px-1 text-lg leading-snug font-semibold outline-none hover:bg-hover focus:bg-hover"
              />
            </div>
          </SheetTitle>
          <SheetDescription className="sr-only">Card details</SheetDescription>
          <div className="flex shrink-0 items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleWatching}
              disabled={loading}
              aria-pressed={watching}
              title={watching ? "You get emails about changes and comments. Click to stop watching." : "Get emails about changes and comments on this card."}
              className="h-8 gap-1.5 px-2 text-xs"
            >
              <Eye className={`size-4 ${watching ? "text-accent" : ""}`} aria-hidden="true" />
              {watching ? "Watching" : "Watch"}
              {watcherCount > 0 && (
                <span className="text-muted-foreground">
                  · {watcherCount}
                  <span className="sr-only"> {watcherCount === 1 ? "watcher" : "watchers"}</span>
                </span>
              )}
            </Button>
            {position && onStep && (
              <>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canPrev}
                  onClick={() => onStep(-1)}
                  aria-label="Previous card (K)"
                  title="Previous card (K)"
                >
                  <ChevronUp className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  disabled={!canNext}
                  onClick={() => onStep(1)}
                  aria-label="Next card (J)"
                  title="Next card (J)"
                >
                  <ChevronDown className="size-4" />
                </Button>
              </>
            )}
            <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close card">
              <X className="size-4" />
            </Button>
          </div>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="p-4 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="flex flex-col gap-6 p-4">
            {isSubtask && parent && onNavigate && (
              <button
                onClick={() => onNavigate(parent.id)}
                className="-mt-2 flex w-fit items-center gap-1 text-xs text-muted-foreground hover:text-foreground hover:underline"
              >
                <ArrowUp className="size-3" />
                Part of: {parent.title}
              </button>
            )}

            <Section title="Description">
              <DescriptionEditor key={cardId} initial={description} onSave={saveDescription} mentionMembers={mentionable} />
            </Section>

            {!isSubtask && cardType === "epic" && boardId && (
              <Section title={`Cards in this epic${epicCount ? ` · ${epicCount}` : ""}`}>
                <EpicCardsSection
                  key={cardId}
                  epicId={cardId}
                  boardId={boardId}
                  onNavigate={onNavigate}
                  onProgress={(p) => {
                    setEpicCount(p.total);
                    onPatch(cardId, { epicProgress: p });
                  }}
                  onChildChange={(childId, inEpic) => onPatch(childId, { epic: inEpic ? { id: cardId, title } : null })}
                />
              </Section>
            )}

            {!isSubtask && (
              <Section title={`Subtasks${subtasks.length ? ` · ${doneCount}/${subtasks.length}` : ""}`}>
                <div className="flex flex-col gap-0.5">
                  {subtasks.map((item) => (
                    <SubtaskRow
                      key={item.id}
                      item={item}
                      cardKeyPrefix={cardKeyPrefix}
                      members={members}
                      onToggleDone={() => toggleItem(item)}
                      onOpen={() => onNavigate?.(item.id)}
                      onRemove={() => removeItem(item)}
                    />
                  ))}
                </div>
                <InlineComposer placeholder="Add a subtask…" buttonLabel="Add" onSubmit={addItem} />
              </Section>
            )}

            {boardId && (
              <Section title="Linked cards">
                <CardLinksSection
                  key={cardId}
                  cardId={cardId}
                  boardId={boardId}
                  onNavigate={onNavigate}
                  onBlockedChange={(blocked) => onPatch(cardId, { blocked })}
                />
              </Section>
            )}

            {reviewFeedback.length > 0 && (
              <Section title={`Review feedback · ${reviewFeedback.length}`}>
                <CardReviewFeedback
                  key={cardId}
                  items={reviewFeedback}
                  cardDone={cardDone}
                  doneSubtasks={new Set(subtasks.filter((s) => s.done).map((s) => s.id))}
                />
              </Section>
            )}

            <Section title="Details">
              <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
                {!isSubtask && columns && columns.length > 0 && currentColumnId && onMoveToColumn && (
                  <Field label="Status">
                    <Select
                      value={currentColumnId}
                      onChange={(e) => onMoveToColumn(e.target.value)}
                      className="h-8 w-full py-1 text-sm"
                      aria-label="Status (column)"
                    >
                      {columns.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}

                {!isSubtask && (
                  <Field label="Type">
                    <div className="flex items-center gap-2">
                      <TypeIcon type={cardType} />
                      <Select
                        value={pendingType ?? cardType}
                        onChange={(e) => changeType(e.target.value as CardType)}
                        className="h-8 w-full py-1 text-sm"
                        aria-label="Type"
                      >
                        {CARD_TYPES.map((t) => (
                          <option key={t} value={t}>{CARD_TYPE_LABEL[t]}</option>
                        ))}
                      </Select>
                    </div>
                    {pendingType && (
                      <div role="alert" className="mt-2 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs">
                        <p>
                          This epic has {epicCount} {epicCount === 1 ? "card" : "cards"}. Making it a {CARD_TYPE_LABEL[pendingType].toLowerCase()} takes{" "}
                          {epicCount === 1 ? "it" : "them"} out of the epic.
                        </p>
                        <div className="mt-2 flex gap-2">
                          <Button size="sm" variant="outline" className="h-7" onClick={() => changeType(pendingType, true)}>
                            Make it a {CARD_TYPE_LABEL[pendingType].toLowerCase()}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7" onClick={() => setPendingType(null)}>
                            Keep it an epic
                          </Button>
                        </div>
                      </div>
                    )}
                    {typeNote && <p role="status" className="mt-1 text-xs text-muted-foreground">{typeNote}</p>}
                  </Field>
                )}

                {!isSubtask && cardType !== "epic" && boardId && (
                  <Field label="Epic">
                    <EpicField
                      key={cardId}
                      cardId={cardId}
                      boardId={boardId}
                      epic={epic}
                      onNavigate={onNavigate}
                      onChange={(e) => onPatch(cardId, { epic: e })}
                    />
                  </Field>
                )}

                <Field label="Priority">
                  <div className="flex items-center gap-2">
                    {priority && <PriorityIcon priority={priority} />}
                    <Select
                      value={priority ?? ""}
                      onChange={(e) => changePriority((e.target.value || null) as Priority | null)}
                      className="h-8 w-full py-1 text-sm"
                      aria-label="Priority"
                    >
                      <option value="">None</option>
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>
                      ))}
                    </Select>
                  </div>
                </Field>

                <Field label={estimateUnit === "hours" ? "Estimate (hours)" : "Estimate (story points)"}>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    max={10000}
                    step="any"
                    value={estimateDraft}
                    onChange={(e) => setEstimateDraft(e.target.value)}
                    onBlur={saveEstimate}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                    }}
                    placeholder="None"
                    aria-label={estimateUnit === "hours" ? "Estimate in hours" : "Estimate in story points"}
                    aria-invalid={estimateError ? true : undefined}
                    aria-describedby={estimateError ? "estimate-error" : undefined}
                    className="h-8 w-28"
                  />
                  {estimateError && (
                    <p id="estimate-error" role="alert" className="mt-1 text-xs text-destructive-ink">{estimateError}</p>
                  )}
                </Field>

                <Field label="Due date">
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={dueDate ? dueDate.slice(0, 10) : ""}
                      onChange={(e) => changeDueDate(e.target.value)}
                      className="h-8 w-auto"
                    />
                    {dueDate && (
                      <Button variant="link" className="h-auto p-0 text-xs" onClick={() => changeDueDate("")}>
                        Clear
                      </Button>
                    )}
                  </div>
                </Field>

                {!isSubtask && sprintsEnabled && cardType !== "epic" && (
                  <Field label="Sprint">
                    <Select
                      value={sprintId ?? ""}
                      onChange={(e) => {
                        const next = e.target.value || null;
                        setSprintId(next);
                        onPatch(cardId, { sprintId: next });
                        assignCardToSprint(cardId, next);
                      }}
                      className="h-8 w-full py-1 text-xs"
                    >
                      <option value="">No sprint</option>
                      {sprints.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </Select>
                  </Field>
                )}

                {!isSubtask && (
                  <Field label="Visibility">
                    <button
                      type="button"
                      aria-pressed={isPrivate}
                      onClick={() => togglePrivate()}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                        isPrivate ? "border-accent/40 bg-accent/10 text-foreground" : "border-border text-muted-foreground hover:bg-hover hover:text-foreground"
                      }`}
                    >
                      {isPrivate ? <Lock className="size-3.5" aria-hidden="true" /> : <Globe className="size-3.5" aria-hidden="true" />}
                      {isPrivate ? "Private" : "Not private"}
                    </button>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {isPrivate ? "Hidden from the board\u2019s public link." : "Shown on the board\u2019s public link, if it has one."}
                    </p>
                  </Field>
                )}

                <Field label="Assignees">
                  <AssigneePicker members={members} assigneeIds={assigneeIds} onToggle={toggleAssignee} />
                </Field>

                <Field label="SMEs">
                  <AssigneePicker members={members} assigneeIds={smeIds} onToggle={toggleSme} />
                </Field>

                <div className="sm:col-span-2">
                  <Field label="Labels">
                    <div className="flex flex-wrap gap-1.5">
                      {workspaceLabels.map((l) => {
                        const on = labelIds.has(l.id);
                        return (
                          <button
                            key={l.id}
                            type="button"
                            onClick={() => toggleLabel(l)}
                            aria-pressed={on}
                            className={`inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                              on
                                ? "border-accent/40 bg-accent/10 text-foreground"
                                : "border-dashed border-border-strong text-muted-foreground hover:bg-hover hover:text-foreground"
                            }`}
                          >
                            <span className="size-2 rounded-full" style={{ backgroundColor: l.color }} aria-hidden="true" />
                            {l.name}
                            {on && <Check className="size-3" aria-hidden="true" />}
                          </button>
                        );
                      })}
                    </div>
                    <div className="mt-2 flex items-center gap-1.5">
                      <Input
                        value={newLabelName}
                        onChange={(e) => setNewLabelName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && addLabel()}
                        placeholder="New label…"
                        className="h-8 w-32 text-xs"
                      />
                      <div className="flex gap-1">
                        {PALETTE.map((c) => (
                          <button
                            key={c}
                            onClick={() => setNewLabelColor(c)}
                            className={`h-5 w-5 rounded-full ${newLabelColor === c ? "ring-2 ring-foreground ring-offset-1" : ""}`}
                            style={{ backgroundColor: c }}
                            title={c}
                          />
                        ))}
                      </div>
                      <Button size="xs" onClick={addLabel}>Add</Button>
                    </div>
                  </Field>
                </div>
              </div>
            </Section>

            <Section title="Attachments">
              <div className="flex flex-col gap-1.5">
                {attachments.length === 0 && <p className="text-sm text-muted-foreground">No attachments.</p>}
                {attachments.map((a) => (
                  <div
                    key={a.id}
                    className="group flex items-center gap-2 rounded-md border border-border px-2 py-1.5"
                  >
                    <span className="flex-1 truncate text-sm" title={a.fileName}>
                      {a.fileName}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground">{formatBytes(a.sizeBytes)}</span>
                    <button
                      onClick={() => downloadAttachment(a)}
                      className="shrink-0 text-xs text-muted-foreground hover:underline"
                    >
                      Download
                    </button>
                    <ConfirmDelete
                      onConfirm={() => removeAttachment(a)}
                      title="Delete this attachment?"
                      description="The uploaded file is permanently deleted and can't be recovered."
                      confirmLabel="Delete file"
                      trigger={
                        <button
                          className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive-ink group-hover:opacity-100"
                          title="Remove"
                        >
                          <X className="size-3.5" />
                        </button>
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <label className="inline-block cursor-pointer rounded-md border border-border-strong px-3 py-1 text-xs hover:bg-hover">
                  {uploading ? "Uploading…" : "+ Add file"}
                  <input
                    type="file"
                    className="hidden"
                    disabled={uploading}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFile(f);
                      e.target.value = "";
                    }}
                  />
                </label>
                {uploadError && <p className="mt-1 text-xs text-destructive-ink">{uploadError}</p>}
              </div>
            </Section>

            <Section title="Whiteboards">
              <div className="flex flex-col gap-1.5">
                {whiteboards.length === 0 && (
                  <p className="text-sm text-muted-foreground">No whiteboards linked to this card.</p>
                )}
                {whiteboards.map((w) => (
                  <Link
                    key={w.id}
                    href={`/whiteboards/${w.id}`}
                    className="flex items-center gap-2 rounded-md border border-border px-2 py-1.5 text-sm hover:bg-hover"
                  >
                    <span className="flex-1 truncate">{w.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">Open →</span>
                  </Link>
                ))}
              </div>
              <form action={createWhiteboardForCard.bind(null, cardId)} className="mt-2">
                <button className="inline-block cursor-pointer rounded-md border border-border-strong px-3 py-1 text-xs hover:bg-hover">
                  + New whiteboard
                </button>
              </form>
            </Section>

            <Section title="Activity">
              <div role="tablist" aria-label="Activity" className="mb-3 flex gap-1">
                {(
                  [
                    ["comments", `Comments${comments.length ? ` · ${comments.length}` : ""}`],
                    ["history", "History"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={activityTab === key}
                    onClick={() => (key === "history" ? showHistory() : setActivityTab("comments"))}
                    className={`h-7 rounded-md px-2.5 text-xs font-semibold outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                      activityTab === key ? "bg-hover text-foreground" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {activityTab === "history" ? (
                <div role="tabpanel" aria-label="History">
                  {history === null ? (
                    <p className="text-sm text-muted-foreground">Loading…</p>
                  ) : history.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No history yet. Changes made from now on are recorded here.</p>
                  ) : (
                    <ol className="flex flex-col gap-2">
                      {history.map((h) => (
                        <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                          <span className="min-w-0">
                            <span className="font-medium">{h.actor}</span> {h.text}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">{formatTime(h.at)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </div>
              ) : (
              <div role="tabpanel" aria-label="Comments">
              <div className="flex flex-col gap-3">
                {comments.length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
                {comments.map((c) => (
                  <div key={c.id} className="group">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium">{c.author.name ?? c.author.email}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground">{formatTime(c.createdAt)}</span>
                        {(c.author.id === currentUserId || isAdmin) && (
                          <button
                            onClick={() => removeComment(c)}
                            className="text-xs text-muted-foreground opacity-0 hover:text-destructive-ink group-hover:opacity-100"
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-0.5">
                      <CommentBody body={c.body} />
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-1">
                <CommentComposer mentionMembers={mentionable} onSubmit={postComment} />
              </div>
              </div>
              )}
            </Section>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-border pt-4">
              {!isSubtask && onMoved && (
                <MoveCardDialog
                  cardId={cardId}
                  currentKey={cardKeyPrefix && keySeq != null ? `${cardKeyPrefix}-${keySeq}` : null}
                  statusId={statusId}
                  onMoved={(result) => onMoved(cardId, result)}
                />
              )}
              <ConfirmDelete
                title="Delete this card?"
                description="This action can't be undone."
                confirmLabel="Delete card"
                onConfirm={handleDelete}
                trigger={
                  <Button variant="link" className="h-auto p-0 text-sm text-destructive-ink">
                    Delete card
                  </Button>
                }
              />
            </div>
          </div>
        )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

/** A compact labeled field for the details grid (lighter than a full Section). */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function AssigneePicker({
  members,
  assigneeIds,
  onToggle,
}: {
  members: MemberT[];
  assigneeIds: Set<string>;
  onToggle: (m: MemberT) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = members.filter((m) => assigneeIds.has(m.id));

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((m) => (
          <span
            key={m.id}
            className="flex items-center gap-1 rounded-full border border-foreground bg-accent px-2 py-0.5 text-xs text-accent-foreground"
          >
            {m.name ?? m.email}
            <button onClick={() => onToggle(m)} className="text-accent-foreground/70 hover:text-accent-foreground" title="Remove">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <button
          onClick={() => setOpen((o) => !o)}
          className="rounded-md border border-border-strong px-2 py-0.5 text-xs text-foreground/70 hover:bg-hover"
        >
          + Assign
        </button>
      </div>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 max-h-56 w-60 overflow-y-auto rounded-md border border-border bg-surface py-1 shadow-lg">
            {members.length === 0 && <p className="px-3 py-1.5 text-sm text-muted-foreground">No members</p>}
            {members.map((m) => {
              const on = assigneeIds.has(m.id);
              return (
                <button
                  key={m.id}
                  onClick={() => onToggle(m)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm hover:bg-hover"
                >
                  <span className="truncate">{m.name ?? m.email}</span>
                  {on && <Check className="size-3.5 shrink-0 text-foreground/70" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function SubtaskRow({
  item,
  cardKeyPrefix,
  members,
  onToggleDone,
  onOpen,
  onRemove,
}: {
  item: SubtaskT;
  cardKeyPrefix: string | null;
  members: MemberT[];
  onToggleDone: () => void;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const assignees = members.filter((m) => item.assigneeIds.includes(m.id));
  const due = dueMeta(item.dueDate);

  return (
    <div className="group flex items-center gap-2 rounded px-1 py-1 hover:bg-hover/50">
      <input
        type="checkbox"
        checked={item.done}
        onChange={onToggleDone}
        className="h-4 w-4 shrink-0"
      />
      <button
        onClick={onOpen}
        className={`flex-1 truncate text-left text-sm hover:underline ${item.done ? "text-muted-foreground line-through" : ""}`}
      >
        {cardKeyPrefix && item.keySeq != null && (
          <span className="mr-1.5 font-mono text-xs font-medium text-muted-foreground">
            {cardKeyPrefix}-{item.keySeq}
          </span>
        )}
        {item.title}
      </button>

      {item.commentCount > 0 && (
        <StatusBadge tone="neutral">
          <MessageSquare className="size-3" />
          {item.commentCount}
        </StatusBadge>
      )}
      {item.attachmentCount > 0 && (
        <StatusBadge tone="neutral">
          <Paperclip className="size-3" />
          {item.attachmentCount}
        </StatusBadge>
      )}
      {due && (
        <span className={`shrink-0 text-[10px] font-medium whitespace-nowrap ${dueToneClass[due.tone]}`}>
          {due.label}
        </span>
      )}
      {assignees.length > 0 && (
        <div className="flex -space-x-1" title={assignees.map((a) => a.name ?? a.email).join(", ")}>
          {assignees.slice(0, 3).map((a) => (
            <span
              key={a.id}
              className="flex size-5 shrink-0 items-center justify-center rounded-full border border-background bg-accent text-[10px] font-medium text-accent-foreground"
            >
              {(a.name ?? a.email).charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      )}

      <button
        onClick={onRemove}
        className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive-ink group-hover:opacity-100"
        title="Remove"
      >
        <X className="size-3.5" />
      </button>
    </div>
  );
}

function formatTime(iso: string) {
  return <LocalTime iso={iso} format="dateTime" />;
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function InlineComposer({
  placeholder,
  buttonLabel,
  multiline,
  onSubmit,
}: {
  placeholder: string;
  buttonLabel: string;
  multiline?: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");

  function submit() {
    const v = value.trim();
    if (!v) return;
    onSubmit(v);
    setValue("");
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          rows={2}
          placeholder={placeholder}
          className="min-h-0 resize-none text-sm"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={placeholder}
          className="h-8 text-sm"
        />
      )}
      {value.trim() && (
        <div>
          <Button size="xs" onClick={submit}>{buttonLabel}</Button>
        </div>
      )}
    </div>
  );
}
