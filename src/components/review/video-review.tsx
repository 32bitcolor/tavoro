"use client";

import { useEffect, useRef, useState } from "react";
import { Crosshair, Download, MessageSquarePlus } from "lucide-react";

import { timecode, type VideoAnchor } from "@/lib/review-anchor";
import { pinDomId, type ReviewFileView } from "@/components/review/file-review";
import { cn } from "@/lib/utils";

// Reviewing a video (docs/REVIEW-LINKS.md): the browser's own <video> plays the file
// (MP4 or WebM, sniffed on upload, served with Range so it seeks). A comment is
// anchored to a moment, optionally with a pin on the frame. Markers on the timeline
// below show every comment; choosing one seeks there.

export type VideoPin = { threadId: string; number: number; anchor: VideoAnchor; open: boolean; label: string };

/** How close (seconds) the playhead must be for a pin to show on the frame. */
const NEAR = 1.5;

export function VideoReview({
  file,
  pins,
  canComment,
  composingAnchor,
  flash,
  onCompose,
  onSelectPin,
  composer,
}: {
  file: ReviewFileView;
  pins: VideoPin[];
  canComment: boolean;
  composingAnchor: VideoAnchor | null;
  flash: string | null;
  onCompose: (anchor: VideoAnchor) => void;
  onSelectPin: (threadId: string) => void;
  composer: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [pinning, setPinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The metadata can arrive before hydration attaches onLoadedMetadata; read it now too.
  useEffect(() => {
    const v = video.current;
    if (v && v.readyState >= 1 && Number.isFinite(v.duration)) setDuration(v.duration);
  }, []);

  // "Jump to" from a thread: the round view flashes the pin's id; seek there.
  useEffect(() => {
    if (!flash) return;
    const pin = pins.find((p) => pinDomId(p.threadId) === flash);
    const v = video.current;
    if (!pin || !v) return;
    v.pause();
    v.currentTime = pin.anchor.t;
    setNow(pin.anchor.t);
  }, [flash, pins]);

  function seek(t: number) {
    const v = video.current;
    if (!v) return;
    v.pause();
    v.currentTime = t;
    setNow(t);
  }

  function commentHere() {
    const v = video.current;
    if (!v) return;
    v.pause();
    setPinning(false);
    onCompose({ kind: "video_time", t: Math.round(v.currentTime * 10) / 10 });
  }

  function pinAt(e: React.MouseEvent<HTMLDivElement>) {
    const v = video.current;
    if (!v) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width));
    const y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    v.pause();
    setPinning(false);
    onCompose({ kind: "video_time", t: Math.round(v.currentTime * 10) / 10, x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  }

  const onFrame = pins.filter((p) => p.anchor.x !== undefined && Math.abs(p.anchor.t - now) <= NEAR);
  const draft = composingAnchor && composingAnchor.x !== undefined && Math.abs(composingAnchor.t - now) <= NEAR ? composingAnchor : null;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="min-w-0 truncate text-sm font-semibold">
          {file.fileName}
          {duration != null && <span className="font-normal text-muted-foreground"> · {timecode(duration)}</span>}
        </h2>
        <a
          href={`${file.url}?download`}
          className="ml-auto inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-muted-foreground hover:bg-hover hover:text-foreground"
        >
          <Download className="size-3.5" aria-hidden="true" /> Download
        </a>
      </div>
      {canComment && (
        <p className="text-xs text-muted-foreground">
          Play to the moment you want, then choose <strong>Comment at {timecode(now)}</strong>. To point at something in the frame, choose{" "}
          <strong>Pin on the frame</strong> and click it.
        </p>
      )}

      {error ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{error}</p>
      ) : (
        <div className="relative overflow-hidden rounded-lg bg-black">
          <video
            ref={video}
            src={file.url}
            controls
            preload="metadata"
            playsInline
            className="block max-h-[70vh] w-full"
            onLoadedMetadata={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : null)}
            onTimeUpdate={(e) => setNow(e.currentTarget.currentTime)}
            onSeeked={(e) => setNow(e.currentTarget.currentTime)}
            onError={() => setError("This video couldn't be played here. You can still download it and comment on moments by time.")}
          />
          {/* Pins near the playhead. The layer stops short of the native controls. */}
          <div
            className={cn("absolute inset-x-0 top-0 bottom-12", pinning ? "cursor-crosshair bg-accent/5" : "pointer-events-none")}
            onClick={pinning ? pinAt : undefined}
            aria-hidden={!pinning}
          >
            {onFrame.map((p) => (
              <button
                key={p.threadId}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectPin(p.threadId);
                }}
                aria-label={`${p.label}, at ${timecode(p.anchor.t)}`}
                className={cn(
                  "pointer-events-auto absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-white text-xs font-semibold text-white shadow",
                  p.open ? "bg-accent" : "bg-muted-foreground",
                )}
                style={{ left: `${p.anchor.x! * 100}%`, top: `${p.anchor.y! * 100}%` }}
              >
                {p.number}
              </button>
            ))}
            {draft && (
              <span
                className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dashed border-white bg-accent/60"
                style={{ left: `${draft.x! * 100}%`, top: `${draft.y! * 100}%` }}
                aria-hidden="true"
              />
            )}
          </div>
        </div>
      )}

      {/* Timeline of comments */}
      <div className="flex flex-col gap-2">
        <div className="relative h-6 rounded bg-muted" aria-label="Comments on the timeline" role="group">
          {duration != null && duration > 0 && (
            <span className="absolute inset-y-0 w-0.5 bg-foreground/40" style={{ left: `${Math.min(100, (now / duration) * 100)}%` }} aria-hidden="true" />
          )}
          {duration != null &&
            duration > 0 &&
            pins.map((p) => (
              <button
                key={p.threadId}
                id={pinDomId(p.threadId)}
                type="button"
                onClick={() => {
                  seek(p.anchor.t);
                  onSelectPin(p.threadId);
                }}
                aria-label={`${p.label}, at ${timecode(p.anchor.t)}`}
                title={`#${p.number} at ${timecode(p.anchor.t)}`}
                className={cn(
                  "absolute top-1/2 flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full text-[10px] font-semibold text-white outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                  p.open ? "bg-accent" : "bg-muted-foreground",
                  flash === pinDomId(p.threadId) && "ring-2 ring-warning",
                )}
                style={{ left: `${Math.min(100, (p.anchor.t / duration) * 100)}%` }}
              >
                {p.number}
              </button>
            ))}
        </div>
        {canComment && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={commentHere}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs font-medium outline-none hover:bg-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <MessageSquarePlus className="size-3.5" aria-hidden="true" /> Comment at {timecode(now)}
            </button>
            <button
              type="button"
              aria-pressed={pinning}
              onClick={() => {
                video.current?.pause();
                setPinning((p) => !p);
              }}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
                pinning ? "border-accent bg-accent/10" : "border-border hover:bg-hover",
              )}
            >
              <Crosshair className="size-3.5" aria-hidden="true" /> {pinning ? "Click the frame…" : "Pin on the frame"}
            </button>
          </div>
        )}
        {composer}
      </div>
    </div>
  );
}
