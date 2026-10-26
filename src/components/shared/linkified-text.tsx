import { splitLinks } from "@/lib/linkify";

/** Plain text with its web addresses turned into links that open in a new tab. */
export function LinkifiedText({ text }: { text: string }) {
  return (
    <>
      {splitLinks(text).map((p, i) =>
        p.href ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer nofollow" className="text-link break-all">
            {p.text}
          </a>
        ) : (
          p.text
        ),
      )}
    </>
  );
}
