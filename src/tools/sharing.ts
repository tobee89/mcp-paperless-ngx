import { z } from "zod";
import { json, page, text } from "../format.js";
import { compact, idArg, listArgs, listQuery } from "./common.js";
import { defineTool, type ToolDefinition } from "./types.js";

const fileVersion = z.enum(["archive", "original"]).default("archive");

export const sharingTools: ToolDefinition[] = [
  defineTool({
    name: "list_share_links",
    title: "List share links",
    description:
      "Every share link on the instance, with its slug, target document and expiry. " +
      "Share links are publicly reachable without login — treat this list as security-relevant.",
    toolset: "sharing",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>("/api/share_links/", listQuery(args));
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "list_document_share_links",
    title: "List share links for a document",
    description: "Existing share links for one document — check this before creating another.",
    toolset: "sharing",
    readOnly: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => json(await client.get(`/api/documents/${args.id}/share_links/`)),
  }),
  defineTool({
    name: "create_share_link",
    title: "Create share link",
    description:
      "Create a public, unauthenticated URL for a document. Anyone holding the link can read the " +
      "document until it expires. Always confirm with the user before creating one, and set an " +
      "expiration unless they explicitly asked for a permanent link.",
    toolset: "sharing",
    readOnly: false,
    inputSchema: {
      document: idArg,
      expiration: z
        .string()
        .nullable()
        .optional()
        .describe("ISO 8601 timestamp when the link stops working. Null means it never expires."),
      file_version: fileVersion,
    },
    handler: async (args, { client }) => {
      const link = await client.post<Record<string, unknown>>(
        "/api/share_links/",
        compact(args as Record<string, unknown>),
      );
      return json({ ...link, url: `${client.publicUrl}/share/${link.slug}` });
    },
  }),
  defineTool({
    name: "delete_share_link",
    title: "Delete share link",
    description: "Revoke a share link immediately. Anyone still holding the URL loses access at once; the document\n      itself is untouched.",
    toolset: "sharing",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`/api/share_links/${args.id}/`);
      return text(`Revoked share link ${args.id}.`);
    },
  }),
  defineTool({
    name: "list_share_link_bundles",
    title: "List share link bundles",
    description:
      "Share link bundles (Paperless-ngx 3.x) expose several documents behind a single public link.",
    toolset: "sharing",
    readOnly: true,
    inputSchema: listArgs,
    handler: async (args, { client }) => {
      const result = await client.list<Record<string, unknown>>(
        "/api/share_link_bundles/",
        listQuery(args),
      );
      return json(page(result, result.results, args.page));
    },
  }),
  defineTool({
    name: "create_share_link_bundle",
    title: "Create share link bundle",
    description:
      "Publish several documents behind one public link. Same warning as create_share_link: this is " +
      "publicly reachable without authentication. Confirm first and prefer a finite expiration.",
    toolset: "sharing",
    readOnly: false,
    inputSchema: {
      document_ids: z.array(idArg).min(1),
      expiration_days: z
        .number()
        .int()
        .nullable()
        .optional()
        .describe("Days until the bundle expires. Null means never."),
      file_version: fileVersion,
    },
    handler: async (args, { client }) =>
      json(await client.post("/api/share_link_bundles/", compact(args as Record<string, unknown>))),
  }),
  defineTool({
    name: "delete_share_link_bundle",
    title: "Delete share link bundle",
    description: "Revoke a share link bundle immediately. Every document in the bundle stops being publicly reachable;\n      the documents themselves are untouched.",
    toolset: "sharing",
    readOnly: false,
    destructive: true,
    inputSchema: { id: idArg },
    handler: async (args, { client }) => {
      await client.delete(`/api/share_link_bundles/${args.id}/`);
      return text(`Revoked share link bundle ${args.id}.`);
    },
  }),
];
