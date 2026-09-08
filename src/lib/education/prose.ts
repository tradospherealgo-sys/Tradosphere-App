import type { ProseBlock } from "@/types/database";

/**
 * Turns an admin's plain-text lesson draft into the structured blocks the
 * reader renders. Blocks are separated by a blank line.
 *
 * A block's first line becomes its heading only when at least one more line
 * follows — a lone line stays a paragraph, because a heading with nothing
 * under it renders as a dangling title.
 */
export function toProseBlocks(text: string): ProseBlock[] {
  return text
    .split(/\n\s*\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [first, ...rest] = chunk.split("\n");
      const remainder = rest.join(" ").trim();
      return remainder ? { h: first.trim(), p: remainder } : { p: first.trim() };
    });
}

/** Round-trips blocks back into the editable plain text `toProseBlocks` reads. */
export function fromProseBlocks(blocks: ProseBlock[]): string {
  return blocks
    .map((b) => (b.h ? `${b.h}\n${b.p ?? ""}`.trim() : (b.p ?? "")))
    .filter(Boolean)
    .join("\n\n");
}
