import { z } from "zod";
import { json, text } from "../format.js";
import { compact, idArg, setPermissions } from "./common.js";
import { bool, intEnum, nullableInt } from "./scalars.js";
import { defineTool, type ToolDefinition } from "./types.js";

const documents = z
  .array(idArg)
  .min(1)
  .describe("IDs of the documents to act on. Always an explicit list — never an unbounded selection.");

const bulkEdit = defineTool({
  name: "bulk_edit_documents",
  title: "Bulk edit documents",
  description:
    "Apply one operation to many documents at once. Far cheaper than looping update_document, and the " +
    "only way to add or remove individual tags without replacing the whole tag list. " +
    "Methods: set_correspondent, set_document_type, set_storage_path, add_tag, remove_tag, modify_tags, " +
    "modify_custom_fields, set_permissions, reprocess, delete, rotate, merge, split, delete_pages, " +
    "edit_pdf, remove_password. " +
    "The destructive methods (delete, delete_pages, split/merge with delete_originals) need explicit user " +
    "confirmation first.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: {
    documents,
    method: z.enum([
      "set_correspondent",
      "set_document_type",
      "set_storage_path",
      "add_tag",
      "remove_tag",
      "modify_tags",
      "modify_custom_fields",
      "set_permissions",
      "delete",
      "reprocess",
      "rotate",
      "merge",
      "edit_pdf",
      "remove_password",
      "split",
      "delete_pages",
    ]),
    correspondent: nullableInt().optional().describe("For set_correspondent."),
    document_type: nullableInt().optional().describe("For set_document_type."),
    storage_path: nullableInt().optional().describe("For set_storage_path."),
    tag: idArg.optional().describe("For add_tag / remove_tag."),
    add_tags: z.array(idArg).optional().describe("For modify_tags."),
    remove_tags: z.array(idArg).optional().describe("For modify_tags."),
    add_custom_fields: z
      .record(z.string(), z.unknown())
      .optional()
      .describe("For modify_custom_fields: {custom_field_id: value}."),
    remove_custom_fields: z.array(idArg).optional().describe("For modify_custom_fields."),
    set_permissions: setPermissions.optional().describe("For set_permissions."),
    owner: nullableInt().optional().describe("For set_permissions."),
    merge: bool()
      .optional()
      .describe("For set_permissions: merge with existing permissions instead of replacing."),
    metadata_document_id: idArg
      .optional()
      .describe("For merge: which source document's metadata the result inherits."),
    delete_originals: bool()
      .optional()
      .describe("For merge/split: delete the source documents afterwards. Irreversible."),
    pages: z
      .string()
      .optional()
      .describe(
        "For split: page groups such as '[1-2,3-4,5]'. For delete_pages: page numbers such as '[2,3,4]'.",
      ),
    degrees: intEnum([90, 180, 270]).optional()
      .describe("For rotate: clockwise rotation in degrees."),
    password: z.string().optional().describe("For remove_password: the PDF's current password."),
  },
  handler: async (args, { client }) => {
    const { documents: ids, method, ...rest } = args as Record<string, unknown> & {
      documents: number[];
      method: string;
    };
    const parameters = compact(rest);
    const result = await client.post("/api/documents/bulk_edit/", {
      documents: ids,
      method,
      parameters,
    });
    return json({ method, affected: ids.length, result });
  },
});

const mergeDocuments = defineTool({
  name: "merge_documents",
  title: "Merge documents",
  description:
    "Merge several documents into one new PDF, in the order given. The originals stay unless " +
    "delete_originals is set. Runs asynchronously — poll the returned task with get_task.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: {
    documents: documents.describe("Document IDs in the order the pages should appear."),
    metadata_document_id: idArg
      .optional()
      .describe("Copy tags, correspondent and type from this document onto the merged result."),
    delete_originals: bool()
      .default(false)
      .describe("Delete the source documents after a successful merge. Irreversible — confirm first."),
    archive_fallback: bool()
      .optional()
      .describe("Fall back to the archived PDF/A version when an original cannot be merged."),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/merge/", compact(args as Record<string, unknown>))),
});

const rotateDocuments = defineTool({
  name: "rotate_documents",
  title: "Rotate documents",
  description: "Rotate every page of the given documents clockwise by 90, 180 or 270 degrees.",
  toolset: "documents",
  readOnly: false,
  inputSchema: {
    documents,
    degrees: intEnum([90, 180, 270]),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/rotate/", {
      documents: args.documents,
      degrees: args.degrees,
    })),
});

const editPdf = defineTool({
  name: "edit_pdf",
  title: "Edit a PDF",
  description:
    "Reorder, rotate, remove or split out pages of a single document, producing a new document. " +
    "`operations` is a list of page instructions; each entry names a source page and what to do with it. " +
    "Consult the Paperless API docs for the exact operation shape before using this.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: {
    documents: z.array(idArg).length(1).describe("Exactly one document ID."),
    operations: z.array(z.record(z.string(), z.unknown())).min(1),
    delete_original: bool().default(false).describe("Irreversible — confirm first."),
    update_document: bool()
      .optional()
      .describe("Replace the existing document instead of creating a new one."),
    include_metadata: bool().optional().describe("Carry metadata over to the result."),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/edit_pdf/", compact(args as Record<string, unknown>))),
});

const removePassword = defineTool({
  name: "remove_pdf_password",
  title: "Remove a PDF password",
  description:
    "Decrypt password-protected PDFs so Paperless can OCR them. The password is sent to your Paperless " +
    "instance over its API; only use it against an instance you control.",
  toolset: "documents",
  readOnly: false,
  inputSchema: {
    documents,
    password: z.string().min(1),
    update_document: bool().optional(),
    delete_original: bool().default(false),
    include_metadata: bool().optional(),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/remove_password/", compact(args as Record<string, unknown>))),
});

const reprocess = defineTool({
  name: "reprocess_documents",
  title: "Reprocess documents",
  description:
    "Re-run OCR and the archive generation for the given documents, e.g. after changing OCR settings. " +
    "Queued asynchronously; the documents keep their metadata.",
  toolset: "documents",
  readOnly: false,
  inputSchema: { documents },
  handler: async (args, { client }) =>
    json(await client.post("/api/documents/reprocess/", { documents: args.documents })),
});

const deleteDocuments = defineTool({
  name: "delete_documents",
  title: "Delete documents",
  description:
    "Move several documents to the trash at once. Recoverable until the trash is emptied. " +
    "Requires explicit user confirmation — list what will be deleted before calling this.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: { documents },
  handler: async (args, { client }) => {
    await client.post("/api/documents/delete/", { documents: args.documents });
    return text(`Moved ${args.documents.length} document(s) to trash: ${args.documents.join(", ")}.`);
  },
});

export const bulkTools: ToolDefinition[] = [
  bulkEdit,
  mergeDocuments,
  rotateDocuments,
  editPdf,
  removePassword,
  reprocess,
  deleteDocuments,
];
