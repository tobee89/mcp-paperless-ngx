import { z } from "zod";

export interface PromptDefinition {
  name: string;
  title: string;
  description: string;
  argsSchema: z.ZodRawShape;
  build: (args: Record<string, unknown>) => string;
}

/**
 * Prompts encode the workflows people repeat. Shipping them means the careful
 * version of a risky routine — confirm before writing — is the default rather
 * than something each user has to remember to ask for.
 */
export const PROMPTS: PromptDefinition[] = [
  {
    name: "triage_inbox",
    title: "Triage the inbox",
    description:
      "Work through untriaged documents: propose a title, correspondent, type and tags for each, " +
      "then apply only what the user approves.",
    argsSchema: {
      limit: z.string().optional().describe("How many documents to triage in this pass. Default 20."),
    },
    build: (args) => {
      const limit = Number(args.limit ?? 20) || 20;
      return [
        `Triage up to ${limit} untriaged documents in Paperless.`,
        "",
        "Work in this order:",
        "1. Call get_metadata_overview once, so you know every existing tag, correspondent and document type with its ID.",
        "2. Call search_documents with is_in_inbox=true (fall back to is_tagged=false if the instance has no inbox tag),",
        `   page_size=${limit} and content_preview=600.`,
        "3. For each document, propose: a descriptive title (never a scanner filename like SCAN_0001),",
        "   a correspondent, a document type, and one or more tags. Strongly prefer existing entries;",
        "   mark anything that would have to be created new with (NEW).",
        "   Read more of a document with get_document_content only when the preview is not enough.",
        "4. Present all proposals as a single table and stop. Do not write anything yet.",
        "5. Only after the user approves, apply the changes with update_document (and bulk_edit_documents",
        "   where the same change applies to several documents). Create the (NEW) entries first.",
        "6. Finally, remove the inbox tag from the documents you fully processed.",
        "",
        "If a document is ambiguous, say so and ask rather than guessing.",
      ].join("\n");
    },
  },
  {
    name: "find_document",
    title: "Find a document",
    description: "Locate a specific document from a vague description, without flooding the context.",
    argsSchema: {
      description: z.string().describe("What the user remembers about the document."),
    },
    build: (args) => {
      return [
        `Find the document matching: ${String(args.description)}`,
        "",
        "Search cheaply before searching broadly:",
        "1. Try search_documents with a targeted `query` first. Keep content_preview at 0.",
        "2. If nothing matches, widen: try search_autocomplete on the distinctive words to check how",
        "   they are actually spelled in the archive, then search again.",
        "3. If the description implies a sender, date range or kind of document, add the corresponding",
        "   filters instead of relying on full-text alone.",
        "4. Present the candidates as a short list with id, title, date and correspondent.",
        "5. Only fetch get_document_content for a document the user picks, or when a single candidate",
        "   needs confirming.",
      ].join("\n");
    },
  },
  {
    name: "audit_sharing",
    title: "Audit public share links",
    description: "Review every publicly reachable share link and flag the risky ones.",
    argsSchema: {},
    build: () =>
      [
        "Audit the public sharing surface of this Paperless instance.",
        "",
        "1. Call list_share_links and list_share_link_bundles.",
        "2. For each, resolve the document title (get_document) so the user can tell what is exposed.",
        "3. Flag anything that never expires, or that has been public for a long time.",
        "4. Present a table: link slug, document(s), created, expires, risk note.",
        "5. Do not revoke anything on your own — propose what to revoke and wait for the user to decide.",
      ].join("\n"),
  },
];
