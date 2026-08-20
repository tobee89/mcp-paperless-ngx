import { z } from "zod";
import { json, page, text } from "../format.js";
import type { Page } from "../http/client.js";
import { compact, idArg, listArgs, listQuery, matchingAlgorithm, setPermissions } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

/** Fields every "matchable" metadata object shares. */
const matchFields = {
  match: z
    .string()
    .optional()
    .describe("Text this object matches against, interpreted per matching_algorithm."),
  matching_algorithm: matchingAlgorithm.optional(),
  is_insensitive: z.boolean().optional().describe("Case-insensitive matching. Defaults to true."),
  owner: z.number().int().nullable().optional().describe("Owning user ID, or null for unowned."),
  set_permissions: setPermissions.optional(),
};

interface ResourceSpec {
  /** Singular snake_case name used in tool names, e.g. "tag". */
  singular: string;
  /** Plural snake_case name used in tool names, e.g. "tags". */
  plural: string;
  /** API path segment. */
  path: string;
  /** One sentence describing what the object is, reused across descriptions. */
  what: string;
  /** Extra fields on create/update beyond name + matching. */
  extra?: z.ZodRawShape;
  /** Names of extra fields that are required on create. */
  requiredOnCreate?: string[];
}

/**
 * Tags, correspondents, document types and storage paths are the same CRUD
 * resource with different field sets. Generating them from one spec keeps the
 * four in lockstep — the drift between them is a recurring bug in hand-written
 * Paperless clients.
 */
function crudTools(spec: ResourceSpec): ToolDefinition[] {
  const { singular, plural, path, what } = spec;
  const extra = spec.extra ?? {};

  const listTool = defineTool({
    name: `list_${plural}`,
    title: `List ${plural.replace(/_/g, " ")}`,
    description:
      `List ${plural.replace(/_/g, " ")}. ${what} ` +
      `Returns id, name and document_count for each. ` +
      `Call this before creating anything — reusing an existing ${singular.replace(/_/g, " ")} is almost always correct.`,
    toolset: "metadata",
    readOnly: true,
    inputSchema: {
      ...listArgs,
      full: z
        .boolean()
        .default(false)
        .describe("Return every field instead of the id/name/document_count summary."),
    },
    handler: async (args, { client }) => {
      const { full, ...rest } = args;
      const result = await client.list<Record<string, unknown>>(path, listQuery(rest));
      const items = full
        ? result.results
        : result.results.map((item) => ({
            id: item.id,
            name: item.name,
            document_count: item.document_count,
          }));
      return json(page(result, items, args.page));
    },
  });

  const getTool = defineTool({
    name: `get_${singular}`,
    title: `Get ${singular.replace(/_/g, " ")}`,
    description: `Fetch a single ${singular.replace(/_/g, " ")} by ID, with all fields.`,
    toolset: "metadata",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`${path}${args.id}/`)),
  });

  const createTool = defineTool({
    name: `create_${singular}`,
    title: `Create ${singular.replace(/_/g, " ")}`,
    description:
      `Create a new ${singular.replace(/_/g, " ")}. ` +
      `Check list_${plural} first: near-duplicate entries are hard to merge later.`,
    toolset: "metadata",
    readOnly: false,
    inputSchema: {
      name: z.string().min(1).describe("Display name. Must be unique."),
      ...extra,
      ...matchFields,
    },
    handler: async (args, { client }) =>
      json(await client.post(path, compact(args as Record<string, unknown>))),
  });

  const updateTool = defineTool({
    name: `update_${singular}`,
    title: `Update ${singular.replace(/_/g, " ")}`,
    description:
      `Partially update a ${singular.replace(/_/g, " ")}. ` +
      `Only the fields you pass are changed; omitted fields keep their current value.`,
    toolset: "metadata",
    readOnly: false,
    inputSchema: {
      id: idArg,
      name: z.string().min(1).optional(),
      ...Object.fromEntries(
        Object.entries(extra).map(([key, value]) => [key, (value as z.ZodTypeAny).optional()]),
      ),
      ...matchFields,
    },
    handler: async (args, { client }) => {
      const { id, ...rest } = args as Record<string, unknown> & { id: number };
      return json(await client.patch(`${path}${id}/`, compact(rest)));
    },
  });

  const deleteTool = defineTool({
    name: `delete_${singular}`,
    title: `Delete ${singular.replace(/_/g, " ")}`,
    description:
      `Permanently delete a ${singular.replace(/_/g, " ")}. ` +
      `Documents are not deleted, but they lose this assignment and it cannot be restored. ` +
      `Confirm with the user first.`,
    toolset: "metadata",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`${path}${args.id}/`);
      return text(`Deleted ${singular} ${args.id}.`);
    },
  });

  return [listTool, getTool, createTool, updateTool, deleteTool];
}

const bulkEditObjects = defineTool({
  name: "bulk_edit_metadata_objects",
  title: "Bulk edit metadata objects",
  description:
    "Delete or set permissions on many tags, correspondents, document types or storage paths at once. " +
    "Deletion here is permanent — confirm with the user before calling it.",
  toolset: "metadata",
  readOnly: false,
  destructive: true,
  inputSchema: {
    objects: z.array(idArg).min(1).describe("IDs of the objects to act on."),
    object_type: z.enum(["tags", "correspondents", "document_types", "storage_paths"]),
    operation: z.enum(["set_permissions", "delete"]),
    owner: z.number().int().nullable().optional(),
    permissions: setPermissions.optional(),
    merge: z
      .boolean()
      .default(false)
      .describe("Merge with existing permissions instead of replacing them."),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/bulk_edit_objects/", compact(args as Record<string, unknown>))),
});

const testStoragePath = defineTool({
  name: "test_storage_path",
  title: "Test a storage path template",
  description:
    "Render a storage path template against an existing document to see the resulting file path. " +
    "Use this to validate a template before saving it.",
  toolset: "metadata",
  readOnly: true,
  inputSchema: {
    path: z.string().min(1).describe("The storage path template to render."),
    document: idArg.describe("ID of the document to render the template against."),
  },
  handler: async (args, { client }) =>
    json(await client.post("/api/storage_paths/test/", { path: args.path, document: args.document })),
});

const documentCounts = defineTool({
  name: "get_metadata_overview",
  title: "Metadata overview",
  description:
    "One compact snapshot of all tags, correspondents, document types and storage paths with their " +
    "IDs and document counts. Cheaper than four separate list calls and the right first step before " +
    "filing or triaging documents.",
  toolset: "metadata",
  readOnly: true,
  inputSchema: {},
  handler: async (_args, { client }) => {
    const summarise = (items: Array<Record<string, unknown>>) =>
      items.map((item) => ({
        id: item.id,
        name: item.name,
        count: item.document_count,
        ...(item.parent ? { parent: item.parent } : {}),
      }));

    const [tags, correspondents, documentTypes, storagePaths] = await Promise.all([
      client.listAll<Record<string, unknown>>("/api/tags/"),
      client.listAll<Record<string, unknown>>("/api/correspondents/"),
      client.listAll<Record<string, unknown>>("/api/document_types/"),
      client.listAll<Record<string, unknown>>("/api/storage_paths/"),
    ]);

    return json({
      tags: summarise(tags),
      correspondents: summarise(correspondents),
      document_types: summarise(documentTypes),
      storage_paths: summarise(storagePaths),
    });
  },
});

export const metadataTools: ToolDefinition[] = [
  ...crudTools({
    singular: "tag",
    plural: "tags",
    path: "/api/tags/",
    what: "Tags are the primary way documents are categorised, and can be nested via `parent`.",
    extra: {
      color: z.string().optional().describe("Hex colour such as '#a6cee3'."),
      is_inbox_tag: z
        .boolean()
        .optional()
        .describe("Inbox tags are applied to newly consumed documents and mark them as untriaged."),
      parent: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("Parent tag ID for nested tags (Paperless-ngx 3.x). Null for a top-level tag."),
    },
  }),
  ...crudTools({
    singular: "correspondent",
    plural: "correspondents",
    path: "/api/correspondents/",
    what: "A correspondent is the sender or counterparty a document came from.",
  }),
  ...crudTools({
    singular: "document_type",
    plural: "document_types",
    path: "/api/document_types/",
    what: "A document type says what kind of document it is (invoice, contract, payslip).",
  }),
  ...crudTools({
    singular: "storage_path",
    plural: "storage_paths",
    path: "/api/storage_paths/",
    what: "A storage path is a filename template controlling where Paperless stores the file on disk.",
    extra: {
      path: z
        .string()
        .describe(
          "Filename template, e.g. '{created_year}/{correspondent}/{title}'. Required when creating.",
        ),
    },
  }),
  testStoragePath,
  bulkEditObjects,
  documentCounts,
];

export type { Page };
