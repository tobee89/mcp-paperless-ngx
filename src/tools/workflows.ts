import { z } from "zod";
import { json, page, text } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

/**
 * Workflow triggers and actions carry ~30 fields each with heavy interdependencies.
 * Declaring every one of them would add more schema noise than it removes guesswork,
 * so they are passed through as objects with the field vocabulary spelled out in the
 * description. Reading an existing workflow first is the reliable way to get the shape right.
 */
const TRIGGER_HELP =
  "Trigger object. type: 1=consumption started, 2=document added, 3=document updated, 4=scheduled. " +
  "Common fields: sources (1=consume folder, 2=API upload, 3=mail fetch), filter_filename, filter_path, " +
  "filter_mailrule, match + matching_algorithm, filter_has_tags / filter_has_all_tags / filter_has_not_tags, " +
  "filter_has_any_correspondents, filter_has_any_document_types, filter_custom_field_query, and for " +
  "scheduled triggers schedule_offset_days, schedule_is_recurring, schedule_recurring_interval_days, " +
  "schedule_date_field (added|created|modified|custom_field).";

const ACTION_HELP =
  "Action object. type: 1=assignment, 2=removal, 3=email, 4=webhook, 5=..., 6=... " +
  "Assignment actions use assign_title, assign_tags, assign_correspondent, assign_document_type, " +
  "assign_storage_path, assign_owner, assign_view_users/groups, assign_custom_fields. " +
  "Removal actions use the remove_* counterparts. Email and webhook actions nest their own config object.";

const listOf = (path: string, name: string, description: string, toolset: "workflows") =>
  defineTool({
    name: `list_${name}`,
    title: `List ${name.replace(/_/g, " ")}`,
    description,
    toolset,
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>(path, listQuery(args));
      return json(page(result, result.results, args.page));
    },
  });

export const workflowTools: ToolDefinition[] = [
  listOf(
    "/api/workflows/",
    "workflows",
    "Automation rules on this instance, each with its triggers and actions inlined. " +
      "Read these before changing filing behaviour — a workflow may already be doing what the user " +
      "is asking you to do by hand.",
    "workflows",
  ),
  defineTool({
    name: "get_workflow",
    title: "Get workflow",
    description: "One workflow with its full trigger and action definitions.",
    toolset: "workflows",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/workflows/${args.id}/`)),
  }),
  defineTool({
    name: "create_workflow",
    title: "Create workflow",
    description:
      "Create an automation rule. Workflows run automatically against future documents, so a mistake " +
      "here silently mis-files everything that arrives afterwards. Read an existing workflow with " +
      "get_workflow to copy the exact shape, and confirm the rule with the user before creating it. " +
      TRIGGER_HELP +
      " " +
      ACTION_HELP,
    toolset: "workflows",
    readOnly: false,
    inputSchema: {
      name: z.string().min(1),
      order: z.number().int().default(0).describe("Lower numbers run first."),
      enabled: z.boolean().default(true),
      triggers: z.array(z.record(z.string(), z.unknown())).min(1).describe(TRIGGER_HELP),
      actions: z.array(z.record(z.string(), z.unknown())).min(1).describe(ACTION_HELP),
    },
    handler: async (args, { client }) =>
      json(await client.post("/api/workflows/", compact(args as Record<string, unknown>))),
  }),
  defineTool({
    name: "update_workflow",
    title: "Update workflow",
    description:
      "Update a workflow. Passing `triggers` or `actions` replaces the existing list wholesale — fetch " +
      "the current definition with get_workflow, modify it, and send the complete list back. " +
      "To simply switch a rule off, pass enabled:false and nothing else.",
    toolset: "workflows",
    readOnly: false,
    inputSchema: {
      id: idArg,
      name: z.string().min(1).optional(),
      order: z.number().int().optional(),
      enabled: z.boolean().optional(),
      triggers: z.array(z.record(z.string(), z.unknown())).optional(),
      actions: z.array(z.record(z.string(), z.unknown())).optional(),
    },
    handler: async (args, { client }) => {
      const { id, ...rest } = args;
      return json(await client.patch(`/api/workflows/${id}/`, compact(rest)));
    },
  }),
  defineTool({
    name: "delete_workflow",
    title: "Delete workflow",
    description: "Delete an automation rule permanently. Consider update_workflow with enabled:false instead.",
    toolset: "workflows",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`/api/workflows/${args.id}/`);
      return text(`Deleted workflow ${args.id}.`);
    },
  }),
  listOf(
    "/api/workflow_triggers/",
    "workflow_triggers",
    "Trigger definitions across all workflows. Useful for auditing what fires when.",
    "workflows",
  ),
  listOf(
    "/api/workflow_actions/",
    "workflow_actions",
    "Action definitions across all workflows. Useful for auditing what gets assigned automatically.",
    "workflows",
  ),
];
