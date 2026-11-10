"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import {
  renameStoryboard,
  setStoryboardStatus,
  updateStoryboardDescription,
  deleteStoryboard,
} from "@/app/actions/storyboards";
import { STORYBOARD_STATUSES, STORYBOARD_STATUS_LABEL, type StoryboardStatus } from "@/lib/storyboard";
import { useSetPageTitle } from "@/components/app-shell/breadcrumbs";
import { PageContainer, PageHeader } from "@/components/shared/page";
import { InlineTitle } from "@/components/shared/inline-title";
import { ConfirmDelete } from "@/components/shared/confirm-delete";
import { SaveAsTemplate } from "@/components/templates/save-as-template";
import { ExportMenu } from "@/components/shared/export-menu";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ScreensSection, type ScreenInit, type ProjectObjective } from "@/components/storyboard/screens-section";
import { StoryboardWhiteboards, type LinkedWhiteboard } from "@/components/storyboard/storyboard-whiteboards";
import { StoryboardCourse } from "@/components/storyboard/storyboard-course";

type StoryboardMeta = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  deliverable: { id: string; name: string; projectId: string; projectName: string; cardId?: string | null } | null;
};

export function StoryboardView({
  storyboard,
  initialScreens,
  projectObjectives,
  whiteboards,
}: {
  storyboard: StoryboardMeta;
  initialScreens: ScreenInit[];
  projectObjectives: ProjectObjective[];
  whiteboards: LinkedWhiteboard[];
}) {
  const [title, setTitle] = useState(storyboard.title);
  const [description, setDescription] = useState(storyboard.description ?? "");
  const [status, setStatus] = useState(storyboard.status);
  const [, startTransition] = useTransition();
  useSetPageTitle(title);

  return (
    <PageContainer>
      <PageHeader
        title={
          <InlineTitle
            value={title}
            onChange={setTitle}
            onCommit={() => {
              if (title.trim() && title !== storyboard.title) startTransition(() => void renameStoryboard(storyboard.id, title));
            }}
            ariaLabel="Storyboard title"
          />
        }
        description={
          storyboard.deliverable ? (
            <>
              Linked to{" "}
              <Link href={`/projects/${storyboard.deliverable.projectId}`} className="underline-offset-2 hover:underline">
                {storyboard.deliverable.name}
              </Link>{" "}
              · {storyboard.deliverable.projectName}
            </>
          ) : undefined
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <StoryboardCourse storyboardId={storyboard.id} status={status} hasCard={!!storyboard.deliverable?.cardId} />
            <ExportMenu wordHref={`/api/storyboards/${storyboard.id}/export`} printHref={`/print/storyboards/${storyboard.id}`} />
          </div>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">Status</span>
          <span className="inline-flex w-40">
            <Select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                startTransition(() => void setStoryboardStatus(storyboard.id, e.target.value));
              }}
            >
              {STORYBOARD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STORYBOARD_STATUS_LABEL[s as StoryboardStatus]}
                </option>
              ))}
            </Select>
          </span>
        </label>
      </div>

      <Textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => updateStoryboardDescription(storyboard.id, description)}
        placeholder="Add a storyboard description…"
        rows={2}
        className="mt-4 resize-none"
      />

      <ScreensSection
        storyboardId={storyboard.id}
        initial={initialScreens}
        projectObjectives={projectObjectives}
      />

      <StoryboardWhiteboards storyboardId={storyboard.id} whiteboards={whiteboards} />

      <div className="mt-10 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <SaveAsTemplate kind="storyboard" sourceId={storyboard.id} sourceName={title} />
        <ConfirmDelete
          title="Delete this storyboard?"
          description="This permanently deletes the storyboard and all of its screens."
          confirmLabel="Delete storyboard"
          onConfirm={() => deleteStoryboard(storyboard.id)}
          trigger={
            <Button variant="ghost" className="text-destructive-ink hover:bg-destructive/10 hover:text-destructive-ink">
              Delete storyboard
            </Button>
          }
        />
      </div>
    </PageContainer>
  );
}
