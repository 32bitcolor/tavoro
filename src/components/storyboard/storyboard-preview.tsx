"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { X } from "lucide-react";
import { plainText } from "@/lib/review-snapshot";
import type { ScreenInit } from "@/components/storyboard/storyboard-studio";

// What learners would read: every screen's on-screen text, one after another, like a
// Rise lesson scroll. No team notes. Esc or Close returns to editing.

function parse(s: string | null) {
  if (!s) return "";
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function ReadOnly({ doc }: { doc: string | null }) {
  const editor = useEditor({ extensions: [StarterKit], content: parse(doc), editable: false, immediatelyRender: false, editorProps: { attributes: { class: "tiptap lesson-prose" } } });
  return <EditorContent editor={editor} />;
}

export function StoryboardPreview({ title, description, screens, at, onClose }: { title: string; description: string; screens: ScreenInit[]; at?: string; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    close.current?.focus();
    const t = setTimeout(() => document.getElementById(`preview-${at}`)?.scrollIntoView({ block: "start" }), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      clearTimeout(t);
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [at, onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={`Preview: ${title}`} className="fixed inset-0 z-50 flex flex-col bg-background">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4">
        <span className="rounded bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">Preview</span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="hidden text-xs text-muted-foreground sm:inline">What learners see. Team notes are hidden.</span>
        <button ref={close} type="button" onClick={onClose} className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-hover">
          <X className="size-4" aria-hidden /> Close
        </button>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="Lessons" className="hidden w-64 shrink-0 overflow-y-auto border-r border-border bg-surface-muted/40 p-3 lg:block">
          <ol className="flex flex-col gap-0.5 text-sm">
            {screens.map((s, i) => (
              <li key={s.id}>
                <a href={`#preview-${s.id}`} className="flex gap-2 rounded px-2 py-1.5 text-foreground/80 hover:bg-hover">
                  <span className="w-5 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{i + 1}</span>
                  <span className="min-w-0 truncate">{s.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>
        <div ref={box} className="min-w-0 flex-1 overflow-y-auto scroll-smooth">
          <div className="border-b border-border bg-accent/5 px-6 py-14 text-center">
            <h1 className="mx-auto max-w-2xl text-4xl font-semibold tracking-tight">{title}</h1>
            {description && <p className="mx-auto mt-3 max-w-xl text-muted-foreground">{description}</p>}
            <p className="mt-4 text-xs text-muted-foreground">{screens.length} screens</p>
          </div>
          {screens.map((s, i) => (
            <section key={s.id} id={`preview-${s.id}`} aria-labelledby={`preview-h-${s.id}`} className="scroll-mt-4 border-b border-border px-6 py-12">
              <div className="mx-auto max-w-[44rem]">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Screen {i + 1}</p>
                <h2 id={`preview-h-${s.id}`} className="mt-1 text-3xl font-semibold tracking-tight">
                  {s.title}
                </h2>
                <div className="mt-2 h-1 w-12 rounded-full bg-accent" aria-hidden />
                <div className="mt-6">{plainText(s.onScreenText) ? <ReadOnly doc={s.onScreenText} /> : <p className="text-sm italic text-muted-foreground">No on-screen text yet.</p>}</div>
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
