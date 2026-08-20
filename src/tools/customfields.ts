import { z } from "zod";
import { json, page, text, summarise } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { bool } from "./scalars.js";
import { defineTool, type ToolDefinition } from "./types.js";

const dataType = z
  .enum([
    "string",
    "longtext",
    "url",
    "date",
    "boolean",
    "integer",
    "float",
    "monetary",
    "documentlink",
    "select",
  ])
  .describe(
    "Field type. 'select' requires extra_data.select_options; 'monetary' stores a currency-prefixed " +
      "amount; 'documentlink' stores references to other document IDs.",
  );

export const customFieldTools: ToolDefinition[] = [
  defineTool({
    name: "list_custom_fields",
    title: "List custom fields",
    description:
      "Custom fields defined on this instance, with their IDs, data types and how many documents use " +
      "them. You need the IDs before you can read or write custom field values on a document.",
    toolset: "customfields",
    readOnly: true,
    inputSchema: {
      ...listArgs,
      full: bool()
        .default(false)
        .describe("Return every field instead of the identifying summary."),
    },
    handler: async (args, { client }) => {
      const { full, ...query } = args;
      const result = await client.list<Record<string, unknown>>("/api/custom_fields/", listQuery(query));
      const items = summarise(result.results, ["id", "name", "data_type", "document_count", "extra_data"].map(String), full);
      return json(page(result, items, args.page));
    },
  }),
  defineTool({
    name: "get_custom_field",
    title: "Get custom field",
    description: "One custom field definition including its select options, if any.",
    toolset: "customfields",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/custom_fields/${args.id}/`)),
  }),
  defineTool({
    name: "create_custom_field",
    title: "Create custom field",
    description:
      "Define a new custom field. The data type cannot be changed afterwards, so pick it deliberately.",
    toolset: "customfields",
    readOnly: false,
    inputSchema: {
      name: z.string().min(1),
      data_type: dataType,
      extra_data: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Type-specific configuration. For 'select': {\"select_options\": [{\"label\": \"Open\"}, {\"label\": \"Paid\"}]}. " +
            "For 'monetary': {\"default_currency\": \"EUR\"}.",
        ),
    },
    handler: async (args, { client }) =>
      json(await client.post("/api/custom_fields/", compact(args as Record<string, unknown>))),
  }),
  defineTool({
    name: "update_custom_field",
    title: "Update custom field",
    description:
      "Rename a custom field or adjust its extra_data (e.g. add select options). " +
      "Changing data_type is not supported by Paperless.",
    toolset: "customfields",
    readOnly: false,
    inputSchema: {
      id: idArg,
      name: z.string().min(1).optional(),
      extra_data: z.record(z.string(), z.unknown()).optional(),
    },
    handler: async (args, { client }) => {
      const { id, ...rest } = args;
      return json(await client.patch(`/api/custom_fields/${id}/`, compact(rest)));
    },
  }),
  defineTool({
    name: "delete_custom_field",
    title: "Delete custom field",
    description:
      "Delete a custom field definition and every value stored in it, across all documents. " +
      "This cannot be undone — confirm with the user, and check document_count first.",
    toolset: "customfields",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`/api/custom_fields/${args.id}/`);
      return text(`Deleted custom field ${args.id} and all of its stored values.`);
    },
  }),
];
