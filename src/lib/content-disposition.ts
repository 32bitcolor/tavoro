/** Content-Disposition with an ASCII-safe name and the real (UTF-8) name alongside.
 *  Header values must be Latin-1, so a raw "Präsentation.pdf" would throw. */
export function contentDisposition(fileName: string, kind: "attachment" | "inline" = "attachment"): string {
  const ascii = fileName.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}
