import type { ToolResult } from "./tools/types.js";

/** Plain text answer. */
export const text = (value: string): ToolResult => ({
  content: [{ type: "text", text: value }],
});

/**
 * JSON answer, serialised compactly.
 *
 * Pretty-printing an API response can double its token cost for zero gain —
 * models parse minified JSON just as well.
 */
export const json = (value: unknown): ToolResult => text(JSON.stringify(value));

export const failure = (message: string): ToolResult => ({
  content: [{ type: "text", text: message }],
  isError: true,
});

/** Fields kept when a document is summarised rather than returned whole. */
const DOCUMENT_SUMMARY_FIELDS = [
  "id",
  "title",
  "correspondent",
  "document_type",
  "storage_path",
  "tags",
  "created_date",
  "added",
  "archive_serial_number",
  "page_count",
  "custom_fields",
  "owner",
] as const;

export interface SlimOptions {
  /** Include the full OCR text. Off by default — it is the single biggest token sink. */
  includeContent?: boolean;
  /** Characters of OCR text to keep when content is not fully included. */
  contentPreview?: number;
}

/**
 * Cut a document object down to what a model actually needs.
 *
 * A Paperless document carries its complete OCR text in `content`. A page of 25
 * documents can therefore run to hundreds of thousands of characters and blow
 * the context window — the failure mode users hit first with naive wrappers.
 */
export function slimDocument(
  document: Record<string, unknown>,
  options: SlimOptions = {},
): Record<string, unknown> {
  const { includeContent = false, contentPreview = 0 } = options;
  const out: Record<string, unknown> = {};

  for (const field of DOCUMENT_SUMMARY_FIELDS) {
    const value = document[field];
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    out[field] = value;
  }

  const content = typeof document.content === "string" ? document.content : "";
  if (includeContent) {
    out.content = content;
  } else if (contentPreview > 0 && content.length > 0) {
    out.content_preview = content.slice(0, contentPreview);
    if (content.length > contentPreview) out.content_truncated = true;
  }
  if (!includeContent) {
    out.content_length = content.length;
  }

  // Search responses attach match metadata that is genuinely useful.
  if (document.__search_hit__) out.search_hit = document.__search_hit__;
  if (Array.isArray(document.notes) && document.notes.length > 0) {
    out.note_count = document.notes.length;
  }
  return out;
}

/** Shape returned for every paginated list, so the model can page deliberately. */
export function page<T>(
  result: { count: number; next: string | null; results: unknown[] },
  items: T[],
  pageNumber: number,
): Record<string, unknown> {
  return {
    count: result.count,
    page: pageNumber,
    returned: items.length,
    has_more: Boolean(result.next),
    results: items,
  };
}
