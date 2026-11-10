"use client";

import { useRef, useState, useTransition } from "react";
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
import type { ScreenInit, ProjectObjective } from "@/components/storyboard/storyboard-studio";
import { StoryboardStudio } from "@/components/storyboard/storyboard-studio";
import { StoryboardPreview } from "@/components/storyboard/storyboard-preview";
import { Eye } from "lucide-react";
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
  initialScreen,
}: {
  initialScreen?: string;
  storyboard: StoryboardMeta;
  initialScreens: ScreenInit[];
  projectObjectives: ProjectObjective[];
  whiteboards: LinkedWhiteboard[];
}) {
  const [title, setTitle] = useState(storyboard.title);
  const [description, setDescription] = useState(storyboard.description ?? "");
  const [status, setStatus] = useState(storyboard.status);
  const [, startTransition] = useTransition();
  const [preview, setPreview] = useState<{ screens: ScreenInit[]; at?: string } | null>(null);
  // The screens as edited (the header's Preview shows them).
  const latestRef = useRef<ScreenInit[]>(initialScreens);
  useSetPageTitle(title);

  return (
    <PageContainer size="wide">
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
            <Button type="button" variant="outline" size="sm" onClick={() => setTimeout(() => setPreview({ screens: latestRef.current }), 0)}>
              <Eye className="size-4" aria-hidden /> Preview
            </Button>
            <StoryboardCourse storyboardId={storyboard.id} status={status} hasCard={!!storyboard.deliverable?.cardId} />
            <ExportMenu wordHref={`/api/storyboards/${storyboard.id}/export`} printHref={`/print/storyboards/${storyboard.id}`} />
          </div>
        }
      />

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="sr-only">Status</span>
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              startTransition(() => void setStoryboardStatus(storyboard.id, e.target.value));
            }}
            className="h-8 w-auto py-1 text-sm"
          >
            {STORYBOARD_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STORYBOARD_STATUS_LABEL[s as StoryboardStatus]}
              </option>
            ))}
          </Select>
        </label>
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onBlur={() => description !== (storyboard.description ?? "") && updateStoryboardDescription(storyboard.id, description)}
          aria-label="Storyboard description"
          placeholder="Add a one-line description…"
          className="min-w-0 flex-1 basis-72 rounded-md bg-transparent px-2 py-1 text-sm text-muted-foreground outline-none hover:bg-hover focus:bg-hover focus:text-foreground"
        />
      </div>

      <StoryboardStudio
        storyboardId={storyboard.id}
        initial={initialScreens}
        projectObjectives={projectObjectives}
        initialScreen={initialScreen}
        onChange={(next) => {
          latestRef.current = next;
        }}
        onPreview={(screens, at) => setPreview({ screens, at })}
      />

      {preview && <StoryboardPreview title={title} description={description} screens={preview.screens} at={preview.at} onClose={() => setPreview(null)} />}

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
