import { z } from "zod";
import { json, page, text } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

const filterRule = z.object({
  rule_type: z.number().int().describe("Numeric filter rule type as used by the Paperless web UI."),
  value: z.string().nullable().describe("Rule value, always a string (IDs included)."),
});

export const viewTools: ToolDefinition[] = [
  defineTool({
    name: "list_saved_views",
    title: "List saved views",
    description:
      "Saved views are the filter presets the user built in the Paperless web UI. Reading them is the " +
      "fastest way to learn how this person actually organises their archive — check here before " +
      "inventing your own filters.",
    toolset: "views",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/saved_views/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "get_saved_view",
    title: "Get saved view",
    description: "One saved view including its filter rules, so you can reproduce it as a search.",
    toolset: "views",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/saved_views/${args.id}/`)),
  }),
  defineTool({
    name: "create_saved_view",
    title: "Create saved view",
    description:
      "Save a filter preset that shows up in the user's Paperless sidebar. " +
      "filter_rules use the web UI's numeric rule types — copy the shape from an existing view via " +
      "get_saved_view rather than guessing.",
    toolset: "views",
    readOnly: false,
    inputSchema: {
      name: z.string().min(1),
      filter_rules: z.array(filterRule).default([]),
      sort_field: z.string().nullable().optional().describe("e.g. 'created', 'title'."),
      sort_reverse: z.boolean().optional(),
      page_size: z.number().int().nullable().optional(),
      show_on_dashboard: z.boolean().optional(),
      show_in_sidebar: z.boolean().optional(),
    },
    handler: async (args, { client }) =>
      json(await client.post("/api/saved_views/", compact(args as Record<string, unknown>))),
  }),
  defineTool({
    name: "update_saved_view",
    title: "Update saved view",
    description: "Change a saved view's name, sorting, visibility or filter rules.",
    toolset: "views",
    readOnly: false,
    inputSchema: {
      id: idArg,
      name: z.string().min(1).optional(),
      filter_rules: z.array(filterRule).optional(),
      sort_field: z.string().nullable().optional(),
      sort_reverse: z.boolean().optional(),
      page_size: z.number().int().nullable().optional(),
      show_on_dashboard: z.boolean().optional(),
      show_in_sidebar: z.boolean().optional(),
    },
    handler: async (args, { client }) => {
      const { id, ...rest } = args;
      return json(await client.patch(`/api/saved_views/${id}/`, compact(rest)));
    },
  }),
  defineTool({
    name: "delete_saved_view",
    title: "Delete saved view",
    description: "Remove a saved view. Documents are unaffected.",
    toolset: "views",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`/api/saved_views/${args.id}/`);
      return text(`Deleted saved view ${args.id}.`);
    },
  }),
];
