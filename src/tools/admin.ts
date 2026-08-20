import { z } from "zod";
import { json, page } from "../format.js";
import { idArg, listArgs, listQuery } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * Administrative reads. Deliberately read-only: creating users, resetting
 * passwords or changing global configuration through an LLM is a bad trade,
 * and Paperless already has a UI for it.
 */
export const adminTools: ToolDefinition[] = [
  defineTool({
    name: "list_users",
    title: "List users",
    description:
      "Users on this instance with their IDs and permissions. You need these IDs to set document " +
      "ownership or object-level permissions. Opt-in toolset (PAPERLESS_TOOLSETS=...,admin).",
    toolset: "admin",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/users/", listQuery(args));
      const items = result.results.map((user) => ({
        id: user.id,
        username: user.username,
        first_name: user.first_name,
        last_name: user.last_name,
        is_superuser: user.is_superuser,
        is_active: user.is_active,
        groups: user.groups,
      }));
      return json(page(result, items, args.page));
    },
  }),
  defineTool({
    name: "list_groups",
    title: "List groups",
    description: "Permission groups and their IDs, for use in set_permissions payloads.",
    toolset: "admin",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/groups/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "get_profile",
    title: "Get the current user's profile",
    description:
      "The profile of the user whose API token this server is using. Confirms which account you are " +
      "acting as — worth checking when permissions behave unexpectedly.",
    toolset: "admin",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/profile/")),
  }),
  defineTool({
    name: "get_configuration",
    title: "Get instance configuration",
    description:
      "The instance's application configuration: OCR defaults, output type, barcode settings, AI " +
      "settings. Read-only here; change it in the Paperless UI.",
    toolset: "admin",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/config/")),
  }),
  defineTool({
    name: "list_logs",
    title: "List log files",
    description: "Names of the log files available, e.g. 'paperless' and 'mail'.",
    toolset: "admin",
    readOnly: true,
    inputSchema: {},
    handler: async (_args, { client }) => json(await client.get("/api/logs/")),
  }),
  defineTool({
    name: "get_log",
    title: "Read a log file",
    description:
      "Read one of the instance's log files. Returns the tail by default — logs are long and mostly " +
      "uninteresting, so start small and widen only if you need to.",
    toolset: "admin",
    readOnly: true,
    inputSchema: {
      name: z.enum(["paperless", "mail"]).describe("Log file name from list_logs."),
      lines: z.number().int().min(1).max(2000).default(200).describe("How many trailing lines to return."),
    },
    handler: async (args, { client }) => {
      const entries = await client.get<string[]>(`/api/logs/${args.name}/`);
      const tail = Array.isArray(entries) ? entries.slice(-args.lines) : entries;
      return json({ log: args.name, returned: Array.isArray(tail) ? tail.length : 0, lines: tail });
    },
  }),
  defineTool({
    name: "get_user",
    title: "Get user",
    description: "One user record by ID, including group membership and permission flags. Use it to resolve an owner ID\n      to a human name.",
    toolset: "admin",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/users/${args.id}/`)),
  }),
];
