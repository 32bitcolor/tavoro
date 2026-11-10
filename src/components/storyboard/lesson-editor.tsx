"use client";

import { useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { Bold, Heading2, Heading3, Italic, List, ListOrdered, Quote } from "lucide-react";
import { cn } from "@/lib/utils";

// A borderless rich-text area for the storyboard's "Rise Lite" canvas: no boxed toolbar,
// just text, with formatting on a floating bar when you select something. Saves on blur
// (and when it unmounts with unsaved changes, e.g. switching screens).

function safeParse(s: string | null) {
  if (!s) return "";
  try {
    return JSON.parse(s);
  } catch {
    return s; // legacy plain text
  }
}

export function LessonEditor({
  initial,
  onSave,
  placeholder,
  className,
  label,
}: {
  initial: string | null;
  onSave: (json: string | null) => void;
  placeholder: string;
  className?: string;
  /** Accessible name for the editing area. */
  label: string;
}) {
  const dirty = useRef(false);
  const save = useRef(onSave);
  useEffect(() => {
    save.current = onSave;
  }, [onSave]);

  const editor = useEditor({
    extensions: [StarterKit.configure({ heading: { levels: [2, 3] } }), Placeholder.configure({ placeholder })],
    content: safeParse(initial),
    immediatelyRender: false,
    editorProps: { attributes: { class: cn("tiptap lesson-prose", className ?? ""), "aria-label": label, role: "textbox", "aria-multiline": "true" } },
    onUpdate: () => {
      dirty.current = true;
    },
    onBlur: ({ editor }) => {
      if (!dirty.current) return;
      dirty.current = false;
      save.current(editor.isEmpty ? null : JSON.stringify(editor.getJSON()));
    },
  });

  // Switching screens unmounts the editor: keep what was typed.
  useEffect(() => {
    return () => {
      if (editor && dirty.current) save.current(editor.isEmpty ? null : JSON.stringify(editor.getJSON()));
    };
  }, [editor]);

  return (
    <>
      {editor && <FormatBar editor={editor} />}
      <EditorContent editor={editor} />
    </>
  );
}

function FormatBar({ editor }: { editor: Editor }) {
  const b = (active: boolean) =>
    cn("flex size-7 items-center justify-center rounded text-foreground/75 hover:bg-hover hover:text-foreground", active && "bg-accent text-accent-foreground hover:bg-accent hover:text-accent-foreground");
  const items: { label: string; icon: React.ReactNode; active: boolean; run: () => void }[] = [
    { label: "Bold", icon: <Bold className="size-3.5" />, active: editor.isActive("bold"), run: () => editor.chain().focus().toggleBold().run() },
    { label: "Italic", icon: <Italic className="size-3.5" />, active: editor.isActive("italic"), run: () => editor.chain().focus().toggleItalic().run() },
    { label: "Heading", icon: <Heading2 className="size-3.5" />, active: editor.isActive("heading", { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
    { label: "Subheading", icon: <Heading3 className="size-3.5" />, active: editor.isActive("heading", { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    { label: "Bulleted list", icon: <List className="size-3.5" />, active: editor.isActive("bulletList"), run: () => editor.chain().focus().toggleBulletList().run() },
    { label: "Numbered list", icon: <ListOrdered className="size-3.5" />, active: editor.isActive("orderedList"), run: () => editor.chain().focus().toggleOrderedList().run() },
    { label: "Callout", icon: <Quote className="size-3.5" />, active: editor.isActive("blockquote"), run: () => editor.chain().focus().toggleBlockquote().run() },
  ];
  return (
    <BubbleMenu editor={editor} options={{ placement: "top" }} appendTo={() => document.body}>
      <div role="toolbar" aria-label="Formatting" className="flex items-center gap-0.5 rounded-lg border border-border bg-surface p-1 shadow-lg">
        {items.map((i) => (
          <button key={i.label} type="button" onMouseDown={(e) => e.preventDefault()} onClick={i.run} className={b(i.active)} title={i.label} aria-label={i.label} aria-pressed={i.active}>
            {i.icon}
          </button>
        ))}
      </div>
    </BubbleMenu>
  );
}
