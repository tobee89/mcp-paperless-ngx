import { z } from "zod";
import { json, page, text } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

export const mailTools: ToolDefinition[] = [
  defineTool({
    name: "list_mail_accounts",
    title: "List mail accounts",
    description:
      "IMAP accounts Paperless fetches documents from. Passwords are not returned. " +
      "Opt-in toolset: enable PAPERLESS_TOOLSETS=...,mail to expose these.",
    toolset: "mail",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/mail_accounts/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "get_mail_account",
    title: "Get mail account",
    description: "One mail account in full: server, port, username, folder and security settings. Passwords are never\n      returned by the API.",
    toolset: "mail",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/mail_accounts/${args.id}/`)),
  }),
  defineTool({
    name: "process_mail_account",
    title: "Fetch mail now",
    description:
      "Trigger an immediate fetch for one mail account instead of waiting for the next scheduled run. " +
      "Answers 'why hasn't that email shown up yet'.",
    toolset: "mail",
    readOnly: false,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.post(`/api/mail_accounts/${args.id}/process/`, {});
      return text(`Queued a mail fetch for account ${args.id}. Watch list_tasks for the result.`);
    },
  }),
  defineTool({
    name: "list_mail_rules",
    title: "List mail rules",
    description:
      "Rules deciding which messages become documents, and what metadata they get. " +
      "Read these before debugging why a mailed document was filed the way it was.",
    toolset: "mail",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/mail_rules/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "get_mail_rule",
    title: "Get mail rule",
    description: "One mail rule in full: which messages it matches, what metadata it assigns, and what it does with the\n      message afterwards (leave, mark read, move, delete).",
    toolset: "mail",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/mail_rules/${args.id}/`)),
  }),
  defineTool({
    name: "update_mail_rule",
    title: "Update mail rule",
    description:
      "Change a mail rule. Rules run unattended against a live mailbox, so a wrong filter can consume " +
      "or delete the wrong messages depending on the configured action. Confirm changes with the user.",
    toolset: "mail",
    readOnly: false,
    inputSchema: {
      id: idArg,
      name: z.string().optional(),
      enabled: z.boolean().optional(),
      order: z.number().int().optional(),
      folder: z.string().optional(),
      filter_from: z.string().nullable().optional(),
      filter_to: z.string().nullable().optional(),
      filter_subject: z.string().nullable().optional(),
      filter_body: z.string().nullable().optional(),
      maximum_age: z.number().int().optional().describe("Days back to look."),
      assign_title_from: z.number().int().optional(),
      assign_correspondent: z.number().int().nullable().optional(),
      assign_document_type: z.number().int().nullable().optional(),
      assign_tags: z.array(idArg).optional(),
    },
    handler: async (args, { client }) => {
      const { id, ...rest } = args;
      return json(await client.patch(`/api/mail_rules/${id}/`, compact(rest)));
    },
  }),
  defineTool({
    name: "list_processed_mail",
    title: "List processed mail",
    description:
      "Messages Paperless has already handled, with their status. The place to look when a mail " +
      "arrived but no document appeared.",
    toolset: "mail",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/processed_mail/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
];
