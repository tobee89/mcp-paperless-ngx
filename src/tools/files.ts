import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { basename, isAbsolute, join } from "node:path";
import { z } from "zod";
import { json, text } from "../format.js";
import { compact, idArg } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

const fileVersion = z
  .enum(["archive", "original"])
  .default("archive")
  .describe(
    "'archive' is the OCR'd PDF/A Paperless generated; 'original' is the file as it was consumed.",
  );

const downloadDocument = defineTool({
  name: "download_document",
  title: "Download document",
  description:
    "Save a document's file to disk on the machine running this MCP server and return the path. " +
    "Files are written to PAPERLESS_DOWNLOAD_DIR (defaults to the system temp directory). " +
    "The bytes are deliberately not returned inline — a PDF as base64 would consume the entire context.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    id: idArg,
    version: fileVersion,
    filename: z
      .string()
      .optional()
      .describe("Override the filename. Relative names are resolved inside the download directory."),
  },
  handler: async (args, { client, config }) => {
    const file = await client.binary(`/api/documents/${args.id}/download/`, {
      original: args.version === "original" ? true : undefined,
    });
    const name = args.filename ?? file.filename ?? `document-${args.id}.pdf`;
    const target = isAbsolute(name) ? name : join(config.downloadDir, basename(name));
    await mkdir(config.downloadDir, { recursive: true });
    await writeFile(target, file.data);
    return json({
      id: args.id,
      path: target,
      bytes: file.data.length,
      content_type: file.contentType,
      url: client.documentUrl(args.id),
    });
  },
});

const getThumbnail = defineTool({
  name: "get_document_thumbnail",
  title: "Get document thumbnail",
  description:
    "Return the document's thumbnail image inline so it can actually be looked at. " +
    "Useful for confirming what a document is without reading its whole OCR text.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => {
    const file = await client.binary(`/api/documents/${args.id}/thumb/`);
    return {
      content: [
        {
          type: "image" as const,
          data: file.data.toString("base64"),
          mimeType: file.contentType.startsWith("image/") ? file.contentType : "image/webp",
        },
      ],
    };
  },
});

const bulkDownload = defineTool({
  name: "bulk_download_documents",
  title: "Bulk download documents",
  description:
    "Download several documents as one zip archive, written to the download directory. " +
    "Returns the archive path, not its contents.",
  toolset: "documents",
  readOnly: true,
  inputSchema: {
    documents: z.array(idArg).min(1),
    content: z
      .enum(["archive", "originals", "both"])
      .default("archive")
      .describe("Which file version(s) to include."),
    compression: z.enum(["none", "deflated", "bzip2", "lzma"]).default("deflated"),
    follow_formatting: z
      .boolean()
      .default(false)
      .describe("Lay the archive out according to the documents' storage path templates."),
    filename: z.string().optional().describe("Archive filename. Defaults to a timestamped name."),
  },
  handler: async (args, { client, config }) => {
    const file = await client.postBinary(
      "/api/documents/bulk_download/",
      compact({
        documents: args.documents,
        content: args.content,
        compression: args.compression,
        follow_formatting: args.follow_formatting,
      }),
    );
    const name = args.filename ?? file.filename ?? `paperless-${Date.now()}.zip`;
    const target = join(config.downloadDir, basename(name));
    await mkdir(config.downloadDir, { recursive: true });
    await writeFile(target, file.data);
    return json({
      path: target,
      bytes: file.data.length,
      documents: args.documents.length,
      content_type: file.contentType,
    });
  },
});

const postDocument = defineTool({
  name: "upload_document",
  title: "Upload a document",
  description:
    "Hand a file to Paperless for consumption. Provide either `path` (a file on the machine running " +
    "this server — the cheap option) or `content_base64` (works for remote deployments but costs " +
    "context proportional to the file size; avoid for anything over a few hundred kilobytes). " +
    "Consumption is asynchronous: the returned task ID can be polled with get_task.",
  toolset: "documents",
  readOnly: false,
  inputSchema: {
    path: z.string().optional().describe("Absolute path to the file on the server's filesystem."),
    content_base64: z.string().optional().describe("Base64-encoded file contents."),
    filename: z.string().optional().describe("Filename to present to Paperless. Required with content_base64."),
    title: z.string().optional(),
    created: z.string().optional().describe("Document date, e.g. '2024-04-19'."),
    correspondent: idArg.optional(),
    document_type: idArg.optional(),
    storage_path: idArg.optional(),
    tags: z.array(idArg).optional(),
    archive_serial_number: z.number().int().optional(),
  },
  handler: async (args, { client }) => {
    if (!args.path && !args.content_base64) {
      throw new Error("Provide either `path` or `content_base64`.");
    }
    const bytes = args.path
      ? await readFile(args.path)
      : Buffer.from(args.content_base64 as string, "base64");
    const name = args.filename ?? (args.path ? basename(args.path) : undefined);
    if (!name) throw new Error("`filename` is required when uploading via content_base64.");

    const form = new FormData();
    form.append("document", new Blob([new Uint8Array(bytes)]), name);
    for (const key of ["title", "created", "correspondent", "document_type", "storage_path", "archive_serial_number"] as const) {
      const value = args[key];
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    for (const tag of args.tags ?? []) form.append("tags", String(tag));

    const task = await client.upload<string>("/api/documents/post_document/", form);
    return json({
      task_id: task,
      filename: name,
      bytes: bytes.length,
      note:
        "Consumption runs in the background. Poll list_tasks with this task_id: when status becomes " +
        "'success', the new document's ID is in related_document_ids[0] (also result_data.document_id). " +
        "A typical scan takes a few seconds; a large OCR job can take minutes.",
    });
  },
});

const emailDocument = defineTool({
  name: "email_documents",
  title: "Email documents",
  description:
    "Send one or more documents by email from the Paperless instance. This sends real mail to real " +
    "people — only call it after the user has confirmed the recipients, subject and body.",
  toolset: "documents",
  readOnly: false,
  inputSchema: {
    documents: z.array(idArg).min(1),
    addresses: z.string().min(1).describe("Comma-separated recipient addresses."),
    subject: z.string().min(1),
    message: z.string().min(1),
    use_archive_version: z.boolean().default(true).describe("Attach the archived PDF/A rather than the original."),
  },
  handler: async (args, { client }) => {
    await client.post("/api/documents/email/", {
      documents: args.documents,
      addresses: args.addresses,
      subject: args.subject,
      message: args.message,
      use_archive_version: args.use_archive_version,
    });
    return text(`Sent ${args.documents.length} document(s) to ${args.addresses}.`);
  },
});

const listNotes = defineTool({
  name: "list_document_notes",
  title: "List document notes",
  description:
    "Notes attached to a document, with authors and timestamps. Notes hold context the OCR text does " +
    "not contain — worth reading before drawing conclusions about a document.",
  toolset: "documents",
  readOnly: true,
  inputSchema: { id: idArg },
  handler: async (args, { client }) => json(await client.get(`/api/documents/${args.id}/notes/`)),
});

const createNote = defineTool({
  name: "create_document_note",
  title: "Add a note to a document",
  description: "Attach a free-text note to a document. Use this to record context that belongs with the document\n      rather than in the conversation — why it was kept, what was agreed, what to do next.",
  toolset: "documents",
  readOnly: false,
  inputSchema: { id: idArg, note: z.string().min(1) },
  handler: async (args, { client }) =>
    json(await client.post(`/api/documents/${args.id}/notes/`, { note: args.note })),
});

const deleteNote = defineTool({
  name: "delete_document_note",
  title: "Delete a document note",
  description: "Remove a note from a document. Not recoverable.",
  toolset: "documents",
  readOnly: false,
  destructive: true,
  inputSchema: { id: idArg, note_id: idArg },
  handler: async (args, { client }) => {
    await client.delete(`/api/documents/${args.id}/notes/`, { id: args.note_id });
    return text(`Deleted note ${args.note_id} from document ${args.id}.`);
  },
});

export const fileTools: ToolDefinition[] = [
  downloadDocument,
  getThumbnail,
  bulkDownload,
  postDocument,
  emailDocument,
  listNotes,
  createNote,
  deleteNote,
];
