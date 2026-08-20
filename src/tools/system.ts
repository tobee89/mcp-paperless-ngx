import { z } from "zod";
import { json, page, slimDocument, text, summarise } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { SCHEMA_ENUMS } from "./enums.js";
import { bool, int } from "./scalars.js";
import { defineTool, type ToolDefinition } from "./types.js";

export const systemTools: ToolDefinition[] = [
  defineTool({
    name: "global_search",
    title: "Search everything",
    description:
      "Search across every object type at once — documents, tags, correspondents, document types, " +
      "storage paths, saved views, users, groups, mail rules, custom fields and workflows. " +
      "Returns at most three hits per type, so use it to locate things by name when you do not yet know " +
      "which kind of object you are looking for. For document searches, search_documents is better.",
    toolset: "system",
    readOnly: true,
    inputSchema: {
      query: z.string().min(3).describe("Search term, at least 3 characters."),
      db_only: bool()
        .default(false)
        .describe("Restrict document matching to titles instead of the full-text index."),
    },
    handler: async (args, { client }) => {
      const result = await client.get<Record<string, unknown>>("/api/search/", {
        query: args.query,
        db_only: args.db_only,
      });

      // The endpoint answers with fully hydrated objects — including each
      // document's complete OCR text. Returning that verbatim would make the
      // cheapest-looking tool on the server the most expensive one.
      const named = (items: unknown): Array<Record<string, unknown>> =>
        Array.isArray(items)
          ? items.map((item) => {
              const record = item as Record<string, unknown>;
              return { id: record.id, name: record.name ?? record.username ?? record.title };
            })
          : [];

      return json({
        total: result.total,
        documents: Array.isArray(result.documents)
          ? (result.documents as Array<Record<string, unknown>>).map((document) =>
              slimDocument(document),
            )
          : [],
        tags: named(result.tags),
        correspondents: named(result.correspondents),
        document_types: named(result.document_types),
        storage_paths: named(result.storage_paths),
        saved_views: named(result.saved_views),
        custom_fields: named(result.custom_fields),
        workflows: named(result.workflows),
        mail_rules: named(result.mail_rules),
        mail_accounts: named(result.mail_accounts),
        users: named(result.users),
        groups: named(result.groups),
      });
    },
  }),
  defineTool({
    name: "search_autocomplete",
    title: "Autocomplete a search term",
    description:
      "Completions for a partial search term, ranked by importance in the full-text index. " +
      "Helpful when the user's spelling of a name or term may not match what is in the archive.",
    toolset: "system",
    readOnly: true,
    inputSchema: {
      term: z.string().min(1),
      limit: int().min(1).max(50).default(10),
    },
    handler: async (args, { client }) =>
      json(await client.get("/api/search/autocomplete/", { term: args.term, limit: args.limit })),
  }),
  defineTool({
    name: "get_statistics",
    title: "Archive statistics",
    description:
      "Totals for the archive: document count, inbox count, characters, file type breakdown. " +
      "A cheap orientation call at the start of a session.",
    toolset: "system",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/statistics/")),
  }),
  defineTool({
    name: "get_server_status",
    title: "Server status",
    description:
      "Instance health: Paperless version, database and index status, whether Redis and the task " +
      "workers are reachable, and whether the search index is up to date.",
    toolset: "system",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/status/")),
  }),
  defineTool({
    name: "list_tasks",
    title: "List background tasks",
    description:
      "Background tasks — consumption, merges, reprocessing — with their state and result. " +
      "This is where an upload's outcome shows up, including the ID of the document it created.",
    toolset: "system",
    readOnly: true,
    inputSchema: {
      ...listArgs,
      task_id: z.string().optional().describe("Filter to one task UUID, e.g. the one upload_document returned."),
      status: z
        .enum(SCHEMA_ENUMS.TaskSerializerV10StatusEnum)
        .optional()
        .describe("Paperless reports these lower-case; 'success' and 'failure' are the interesting ones."),
      acknowledged: bool().optional().describe("false shows only tasks the user has not dismissed."),
      full: bool()
        .default(false)
        .describe("Return every field instead of the identifying summary."),
    },
    handler: async (args, { client }) => {
      const { full, ...query } = args;
      const result = await client.list<Record<string, unknown>>("/api/tasks/", listQuery(query));
      const items = summarise(result.results, ["id", "task_id", "task_file_name", "status", "date_created", "date_done", "result", "related_document"].map(String), full);
      return json(page(result, items, args.page));
    },
  }),
  defineTool({
    name: "get_task",
    title: "Get a background task",
    description:
      "One background task by database ID, including its result. Use this to find out whether an " +
      "upload or merge actually succeeded.",
    toolset: "system",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/tasks/${args.id}/`)),
  }),
  defineTool({
    name: "get_active_tasks",
    title: "Currently running tasks",
    description: "Tasks executing right now. Tells you whether the instance is busy.",
    toolset: "system",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/tasks/active/")),
  }),
  defineTool({
    name: "acknowledge_tasks",
    title: "Dismiss tasks",
    description: "Mark finished or failed tasks as acknowledged so they stop showing in the UI.",
    toolset: "system",
    readOnly: false,
    inputSchema: { tasks: z.array(idArg).min(1).describe("Task database IDs, not UUIDs.") },
    handler: async (args, { client }) => {
      await client.post("/api/tasks/acknowledge/", { tasks: args.tasks });
      return text(`Acknowledged ${args.tasks.length} task(s).`);
    },
  }),
  defineTool({
    name: "list_trash",
    title: "List trashed documents",
    description:
      "Documents in the trash, with the date each was deleted and when it will be purged for good.",
    toolset: "system",
    readOnly: true,
    inputSchema: {
      ...listArgs,
      full: bool()
        .default(false)
        .describe("Return every field instead of the identifying summary."),
    },
    handler: async (args, { client }) => {
      const { full, ...query } = args;
      const result = await client.list<Record<string, unknown>>("/api/trash/", listQuery(query));
      const items = summarise(result.results, ["id", "title", "created", "deleted_at", "remaining_days", "correspondent"].map(String), full);
      return json(page(result, items, args.page));
    },
  }),
  defineTool({
    name: "restore_from_trash",
    title: "Restore documents from trash",
    description: "Bring deleted documents back. The safe counterpart to delete_document.",
    toolset: "system",
    readOnly: false,
    inputSchema: { documents: z.array(idArg).min(1) },
    handler: async (args, { client }) => {
      await client.post("/api/trash/", { action: "restore", documents: args.documents });
      return text(`Restored ${args.documents.length} document(s) from trash.`);
    },
  }),
  defineTool({
    name: "empty_trash",
    title: "Empty the trash",
    description:
      "Permanently destroy trashed documents. There is no recovery after this — the files are gone. " +
      "Never call this without the user explicitly asking for it in the current conversation, and list " +
      "what is in the trash first.",
    toolset: "system",
    readOnly: false,
    destructive: true,
    inputSchema: {
      documents: z
        .array(idArg)
        .optional()
        .describe("Specific document IDs to purge. Omit to purge the entire trash."),
    },
    handler: async (args, { client }) => {
      await client.post(
        "/api/trash/",
        compact({ action: "empty", documents: args.documents }),
      );
      return text(
        args.documents
          ? `Permanently deleted ${args.documents.length} document(s).`
          : "Permanently emptied the trash.",
      );
    },
  }),
  defineTool({
    name: "get_remote_version",
    title: "Check for Paperless updates",
    description: "The latest Paperless-ngx release, and whether an update is available.",
    toolset: "system",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/remote_version/")),
  }),
];
