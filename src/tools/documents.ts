import { z } from "zod";
import { json, page, slimDocument, text } from "../format.js";
import type { QueryValue } from "../http/client.js";
import { compact, idArg } from "./common.js";
import { bool, int, nullableInt } from "./scalars.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * Server-side field selection.
 *
 * Paperless supports `?fields=` on the document endpoints. Using it means the
 * OCR text never crosses the wire in the first place, which matters far more
 * than trimming the object after the fact.
 */
const SUMMARY_FIELDS =
  "id,title,correspondent,document_type,storage_path,tags,created_date,added,archive_serial_number,page_count,custom_fields,owner";

/**
 * The document list endpoint accepts 113 filter parameters. Exposing all of
 * them would bury the model in schema; exposing too few makes the tool useless.
 * The named parameters below cover what people actually ask for, and
 * `extra_filters` is the escape hatch for the rest.
 */
const filterArgs = {
  query: z
    .string()
    .optional()
    .describe(
      "Full-text search across document content and metadata. Supports the Paperless query syntax, " +
        "e.g. 'invoice AND 2024', 'correspondent:telekom', 'created:[2024-01-01 TO 2024-12-31]'. " +
        "Prefer this for 'find documents about X' questions.",
    ),
  title__icontains: z
    .string()
    .optional()
    .describe("Case-insensitive substring match on the title only. Cheaper and stricter than query."),
  tags__id__all: z
    .array(idArg)
    .optional()
    .describe("Only documents carrying ALL of these tag IDs."),
  tags__id__in: z
    .array(idArg)
    .optional()
    .describe("Only documents carrying AT LEAST ONE of these tag IDs."),
  tags__id__none: z
    .array(idArg)
    .optional()
    .describe("Exclude documents carrying any of these tag IDs."),
  correspondent__id: idArg.optional().describe("Exact correspondent ID."),
  document_type__id: idArg.optional().describe("Exact document type ID."),
  storage_path__id: idArg.optional().describe("Exact storage path ID."),
  is_tagged: bool()
    .optional()
    .describe("false returns documents with no tags at all — the untriaged pile."),
  is_in_inbox: bool()
    .optional()
    .describe("true returns documents still carrying an inbox tag. The usual starting point for triage."),
  created__date__gte: z.string().optional().describe("Created on or after this date (YYYY-MM-DD)."),
  created__date__lte: z.string().optional().describe("Created on or before this date (YYYY-MM-DD)."),
  added__date__gte: z.string().optional().describe("Added to Paperless on or after this date (YYYY-MM-DD)."),
  added__date__lte: z.string().optional().describe("Added to Paperless on or before this date (YYYY-MM-DD)."),
  archive_serial_number: int().optional().describe("Exact archive serial number."),
  custom_field_query: z
    .string()
    .optional()
    .describe(
      'JSON-encoded custom field filter, e.g. \'["due","range",["2024-08-01","2024-09-01"]]\' or ' +
        '\'["customer","icontains","acme"]\'. See the Paperless API docs for the operator list.',
    ),
  owner__id: idArg.optional().describe("Only documents owned by this user ID."),
  more_like_id: idArg
    .optional()
    .describe("Return documents similar to this document ID. Ignores the other filters."),
  extra_filters: z
    .record(z.string(), z.union([z.string(), z.number(), bool()]))
    .optional()
    .describe(
      "Any additional Django-style filter the documents endpoint accepts, e.g. " +
        "{'content__icontains': 'kündigung', 'created__year': 2024, 'mime_type': 'application/pdf'}. " +
        "Use this for filters not listed above.",
    ),
};

const buildQuery = (args: Record<string, unknown>): Record<string, QueryValue> => {
  const { extra_filters, full_content, content_preview, page: pageNumber, page_size, ordering, ...rest } =
    args as Record<string, unknown>;
  const query: Record<string, unknown> = {
    ...compact(rest),
    ...((extra_filters as Record<string, unknown>) ?? {}),
    page: pageNumber,
    page_size,
    ordering,
  };
  return compact(query) as Record<string, QueryValue>;
};

const searchDocuments = defineTool({
  name: "search_documents",
  title: "Search documents",
  description:
    "Find documents by full-text search, metadata filters, or both. This is the main entry point for " +
    "every 'which documents ...' question. Returns a compact summary per document (id, title, IDs of " +
    "correspondent/type/tags, dates) — NOT the OCR text, which would flood the context. " +
    "Use get_document_content for the text of a specific document.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    ...filterArgs,
    page: int().min(1).default(1),
    page_size: int().min(1).max(200).optional().describe("Default 25."),
    ordering: z
      .string()
      .default("-created")
      .describe("Sort field, '-' prefixed for descending. Common: -created, -added, title, archive_serial_number."),
    content_preview: int()
      .min(0)
      .max(2000)
      .default(0)
      .describe("Include this many characters of OCR text per document. 0 disables it. Keep small."),
  },
  handler: async (args, { client }) => {
    const query = buildQuery(args);
    // Only ask the server for the summary fields unless a preview was requested.
    if (!args.content_preview) query.fields = SUMMARY_FIELDS;
    const result = await client.list<Record<string, unknown>>("/api/documents/", query);
    const items = result.results.map((document) =>
      slimDocument(document, { contentPreview: args.content_preview }),
    );
    return json(page(result, items, args.page));
  },
});

const getDocument = defineTool({
  name: "get_document",
  title: "Get document",
  description:
    "Fetch one document's metadata by ID: title, correspondent, type, tags, dates, custom fields, notes " +
    "and available versions. Does not include the OCR text unless include_content is set.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    id: idArg,
    include_content: bool()
      .default(false)
      .describe("Include the full OCR text. Can be very large — prefer get_document_content."),
  },
  handler: async (args, { client }) => {
    const document = await client.get<Record<string, unknown>>(`/api/documents/${args.id}/`, {
      full_perms: true,
    });
    const slim = slimDocument(document, { includeContent: args.include_content });
    slim.notes = document.notes;
    slim.versions = document.versions;
    slim.url = client.documentUrl(args.id);
    return json(compact(slim));
  },
});

const getDocumentContent = defineTool({
  name: "get_document_content",
  title: "Get document text",
  description:
    "Return the OCR/extracted text of one document. Deliberately a separate tool: this is the most " +
    "expensive thing you can pull from Paperless, so fetch it only for documents you have already " +
    "narrowed down. Supports offset/limit for long documents.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    id: idArg,
    offset: int().min(0).default(0).describe("Character offset to start from."),
    limit: int()
      .min(100)
      .max(200_000)
      .default(20_000)
      .describe("Maximum characters to return."),
  },
  handler: async (args, { client }) => {
    const document = await client.get<{ content?: string; title?: string }>(
      `/api/documents/${args.id}/`,
      { fields: "id,title,content" },
    );
    const content = document.content ?? "";
    const slice = content.slice(args.offset, args.offset + args.limit);
    const remaining = Math.max(0, content.length - (args.offset + slice.length));
    return json({
      id: args.id,
      title: document.title,
      total_length: content.length,
      offset: args.offset,
      returned: slice.length,
      remaining,
      content: slice,
    });
  },
});

const updateDocument = defineTool({
  name: "update_document",
  title: "Update document",
  description:
    "Change metadata on a single document. Only the fields you pass are modified. " +
    "Pass numeric IDs for correspondent, document_type and storage_path — resolve names via " +
    "get_metadata_overview first. Setting `tags` replaces the whole tag list; to add or remove " +
    "individual tags across documents use bulk_edit_documents.",
  toolset: "documents",
  readOnly: false,
  inputSchema: {
    id: idArg,
    title: z.string().optional().describe("Give documents a descriptive title, never a scanner filename."),
    correspondent: nullableInt().optional().describe("Correspondent ID, or null to clear."),
    document_type: nullableInt().optional().describe("Document type ID, or null to clear."),
    storage_path: nullableInt().optional().describe("Storage path ID, or null to clear."),
    tags: z.array(idArg).optional().describe("Complete replacement list of tag IDs."),
    created_date: z.string().optional().describe("Document date as YYYY-MM-DD."),
    archive_serial_number: nullableInt().optional(),
    owner: nullableInt().optional(),
    custom_fields: z
      .array(
        z.object({
          field: idArg.describe("Custom field ID."),
          value: z.unknown().describe("Value matching the field's data type."),
        }),
      )
      .optional()
      .describe("Complete replacement list of custom field values."),
  },
  handler: async (args, { client }) => {
    const { id, ...rest } = args;
    const updated = await client.patch<Record<string, unknown>>(
      `/api/documents/${id}/`,
      compact(rest),
    );
    return json(slimDocument(updated));
  },
});

const deleteDocument = defineTool({
  name: "delete_document",
  title: "Delete document",
  description:
    "Move a document to the trash. It stays recoverable until the trash is emptied or the retention " +
    "period expires. Always confirm with the user before deleting anything.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => {
    await client.delete(`/api/documents/${args.id}/`);
    return text(`Document ${args.id} moved to trash. Restore it with restore_from_trash if this was wrong.`);
  },
});

const getDocumentMetadata = defineTool({
  name: "get_document_metadata",
  title: "Get document file metadata",
  description:
    "Technical file metadata for a document: checksums, byte sizes, MIME type, stored filename, whether " +
    "an archived PDF/A version exists, and embedded PDF metadata. Not the Paperless tags/correspondent — " +
    "use get_document for those.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => json(await client.get(`/api/documents/${args.id}/metadata/`)),
});

const getDocumentHistory = defineTool({
  name: "get_document_history",
  title: "Get document history",
  description:
    "Audit trail of changes to a document — who changed which field, and when. Requires audit logging " +
    "to be enabled on the instance. Returns the most recent entries first; raise `limit` to see further back.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    id: idArg,
    limit: int()
      .min(1)
      .max(200)
      .default(20)
      .describe("Maximum number of history entries to return, newest first."),
  },
  handler: async (args, { client }) => {
    const entries = await client.get<unknown>(`/api/documents/${args.id}/history/`);
    if (!Array.isArray(entries)) return json(entries);
    return json({
      id: args.id,
      total: entries.length,
      returned: Math.min(entries.length, args.limit),
      entries: entries.slice(0, args.limit),
    });
  },
});

const getSuggestions = defineTool({
  name: "get_document_suggestions",
  title: "Get filing suggestions",
  description:
    "Paperless' own suggestions for a document — correspondents, tags, document types and dates its " +
    "classifier considers likely. Useful as a starting point when triaging, but the suggestions are " +
    "only as good as the trained model; verify before applying.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => json(await client.get(`/api/documents/${args.id}/suggestions/`)),
});

const getAiSuggestions = defineTool({
  name: "get_document_ai_suggestions",
  title: "Get AI filing suggestions",
  description:
    "Suggestions from the instance's configured LLM backend (Paperless-ngx 3.x, only if AI features are " +
    "enabled server-side). Returns 404 or an error when AI is disabled — that is expected, not a bug.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => {
    try {
      return json(await client.get(`/api/documents/${args.id}/ai_suggestions/`));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/AI is required|ai_enabled|not enabled/i.test(message)) {
        return json({
          available: false,
          reason:
            "This instance has AI features switched off, so Paperless cannot produce LLM suggestions. " +
            "Use get_document_suggestions for the classifier-based suggestions instead — they need no AI backend.",
        });
      }
      throw error;
    }
  },
});

const nextAsn = defineTool({
  name: "get_next_asn",
  title: "Get next archive serial number",
  description: "The next free archive serial number, for filing a physical document alongside its scan.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {},
  handler: async (_args, { client }) => json(await client.get("/api/documents/next_asn/")),
});

const selectionData = defineTool({
  name: "get_selection_data",
  title: "Summarise a document selection",
  description:
    "For a set of document IDs, return how many of them carry each tag, correspondent, document type and " +
    "storage path. Answers 'what is in this pile?' in one call instead of fetching every document.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { documents: z.array(idArg).min(1) },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/selection_data/", { documents: args.documents })),
});

export const documentTools: ToolDefinition[] = [
  searchDocuments,
  getDocument,
  getDocumentContent,
  updateDocument,
  deleteDocument,
  getDocumentMetadata,
  getDocumentHistory,
  getSuggestions,
  getAiSuggestions,
  nextAsn,
  selectionData,
];
