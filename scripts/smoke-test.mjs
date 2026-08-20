#!/usr/bin/env node
/**
 * Exercise every read-only tool against a real Paperless instance.
 *
 * The unit tests check the server's own logic; this checks the assumptions it
 * makes about Paperless — that endpoints exist, accept these parameters and
 * answer in the expected shape. It writes nothing.
 *
 *   PAPERLESS_URL=... PAPERLESS_TOKEN=... node scripts/smoke-test.mjs
 *   node scripts/smoke-test.mjs --verbose   # also print each response
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const verbose = process.argv.includes("--verbose");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.PAPERLESS_URL || !process.env.PAPERLESS_TOKEN) {
  console.error("PAPERLESS_URL and PAPERLESS_TOKEN must be set.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "build", "index.js")],
  env: { ...process.env, PAPERLESS_TOOLSETS: "all", PAPERLESS_READ_ONLY: "1" },
  stderr: "ignore",
});

const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
const readOnly = tools.map((tool) => tool.name).sort();
console.log(`Server exposes ${readOnly.length} read-only tools.\n`);

const results = [];
let context = {};

/** Call a tool and record what came back. */
async function run(name, args = {}) {
  const started = Date.now();
  try {
    const response = await client.callTool({ name, arguments: args });
    const text = (response.content ?? [])
      .map((part) => (part.type === "text" ? part.text : `<${part.type}>`))
      .join("");
    const ms = Date.now() - started;
    if (response.isError) {
      results.push({ name, status: "FAIL", ms, detail: text.slice(0, 200) });
    } else {
      results.push({ name, status: "ok", ms, bytes: text.length });
      if (verbose) console.log(`--- ${name}\n${text.slice(0, 600)}\n`);
    }
    return text;
  } catch (error) {
    results.push({ name, status: "ERROR", ms: Date.now() - started, detail: String(error).slice(0, 200) });
    return "";
  }
}

const parse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

// --- Phase 1: calls that need no prior knowledge -----------------------------
await run("get_statistics");
await run("get_server_status");
await run("get_remote_version");
await run("get_metadata_overview");
await run("get_next_asn");
await run("get_profile");
await run("get_configuration");
await run("list_logs");
await run("list_users");
await run("list_groups");

for (const name of [
  "list_tags",
  "list_correspondents",
  "list_document_types",
  "list_storage_paths",
  "list_custom_fields",
  "list_saved_views",
  "list_share_links",
  "list_share_link_bundles",
  "list_workflows",
  "list_workflow_triggers",
  "list_workflow_actions",
  "list_mail_accounts",
  "list_mail_rules",
  "list_processed_mail",
  "list_tasks",
  "list_trash",
  "get_active_tasks",
]) {
  await run(name, { page: 1, page_size: 5 });
}

// --- Phase 2: search, then reuse an ID it returns ----------------------------
const search = parse(await run("search_documents", { page_size: 3, ordering: "-added" }));
const documentId = search?.results?.[0]?.id;
context = { documentId };

if (documentId) {
  await run("get_document", { id: documentId });
  await run("get_document_content", { id: documentId, limit: 500 });
  await run("get_document_metadata", { id: documentId });
  await run("get_document_history", { id: documentId });
  await run("get_document_suggestions", { id: documentId });
  await run("get_document_ai_suggestions", { id: documentId });
  await run("get_document_thumbnail", { id: documentId });
  await run("list_document_notes", { id: documentId });
  await run("list_document_share_links", { id: documentId });
  await run("get_selection_data", { documents: [documentId] });
  await run("download_document", { id: documentId });
} else {
  console.log("No documents found — skipping the per-document tools.\n");
}

// Filters that exercise the query-building path rather than just the endpoint.
await run("search_documents", { is_in_inbox: true, page_size: 5 });
await run("search_documents", { is_tagged: false, page_size: 5 });
await run("search_documents", { query: "rechnung", page_size: 3, content_preview: 120 });
await run("search_documents", { extra_filters: { created__year: 2024 }, page_size: 3 });
await run("global_search", { query: "telekom" });
await run("search_autocomplete", { term: "rech", limit: 5 });

// Detail endpoints: take the first ID each list returns, so nothing is hard-coded.
const firstIdOf = async (listTool) => {
  const parsed = parse(await run(listTool, { page_size: 1 }));
  return parsed?.results?.[0]?.id;
};

for (const [listTool, detailTool] of [
  ["list_tags", "get_tag"],
  ["list_correspondents", "get_correspondent"],
  ["list_document_types", "get_document_type"],
  ["list_storage_paths", "get_storage_path"],
  ["list_custom_fields", "get_custom_field"],
  ["list_saved_views", "get_saved_view"],
  ["list_workflows", "get_workflow"],
  ["list_mail_accounts", "get_mail_account"],
  ["list_mail_rules", "get_mail_rule"],
  ["list_tasks", "get_task"],
  ["list_users", "get_user"],
]) {
  const id = await firstIdOf(listTool);
  if (id) await run(detailTool, { id });
  else console.log(`(${detailTool} skipped — ${listTool} returned nothing)`);
}

await run("get_log", { name: "paperless", lines: 5 });

const storagePathId = await firstIdOf("list_storage_paths");
if (storagePathId && context.documentId) {
  await run("test_storage_path", { path: "{created_year}/{title}", document: context.documentId });
}

if (context.documentId) {
  await run("bulk_download_documents", { documents: [context.documentId] });
}

await client.close();

// --- Report -----------------------------------------------------------------
const failed = results.filter((r) => r.status !== "ok");
const width = Math.max(...results.map((r) => r.name.length));

for (const r of results) {
  const mark = r.status === "ok" ? "✔" : "✘";
  const detail = r.status === "ok" ? `${String(r.bytes).padStart(7)} B` : r.detail;
  console.log(`${mark} ${r.name.padEnd(width)} ${String(r.ms).padStart(5)} ms  ${detail}`);
}

const heaviest = results
  .filter((r) => r.status === "ok")
  .sort((a, b) => b.bytes - a.bytes)
  .slice(0, 5);

console.log(`\n${results.length - failed.length}/${results.length} calls succeeded.`);
console.log(`Heaviest responses: ${heaviest.map((r) => `${r.name} (${r.bytes} B)`).join(", ")}`);
if (context.documentId) console.log(`Document used for per-document tools: ${context.documentId}`);

const untested = readOnly.filter((name) => !results.some((r) => r.name === name));
if (untested.length > 0) console.log(`\nNot covered by this script: ${untested.join(", ")}`);

process.exit(failed.length > 0 ? 1 : 0);
