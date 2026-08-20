#!/usr/bin/env node
/**
 * Exercise the write operations against a live Paperless-ngx instance.
 *
 * WHAT THIS TOUCHES: only objects it creates itself, every one of them named
 * with the `zz-mcp-test` prefix, and it deletes them again at the end. It never
 * modifies a document it did not upload. Interrupt it mid-run and you may be
 * left with `zz-mcp-test` leftovers — they are safe to delete.
 *
 * Still: point it at a test instance if you have one.
 *
 *   PAPERLESS_URL=... PAPERLESS_TOKEN=... node scripts/write-test.mjs
 *   node scripts/write-test.mjs --keep   # skip the cleanup, to inspect the result
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const keep = process.argv.includes("--keep");
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(root, "test", "fixtures", "sample-invoice.pdf");
const PREFIX = "zz-mcp-test";

if (!process.env.PAPERLESS_URL || !process.env.PAPERLESS_TOKEN) {
  console.error("PAPERLESS_URL and PAPERLESS_TOKEN must be set.");
  process.exit(2);
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, "build", "index.js")],
  env: { ...process.env, PAPERLESS_TOOLSETS: "all" },
  stderr: "ignore",
});
const client = new Client({ name: "write-test", version: "1.0.0" });
await client.connect(transport);

const results = [];
const created = { tags: [], correspondents: [], documentTypes: [], customFields: [], documents: [] };

async function call(name, args, { expectFailure = false } = {}) {
  try {
    const response = await client.callTool({ name, arguments: args });
    const text = (response.content ?? [])
      .map((part) => (part.type === "text" ? part.text : `<${part.type}>`))
      .join("");
    const failed = Boolean(response.isError);
    results.push({
      name,
      status: failed === expectFailure ? "ok" : "FAIL",
      detail: failed ? text.slice(0, 160) : "",
    });
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  } catch (error) {
    results.push({ name, status: "ERROR", detail: String(error).slice(0, 160) });
    return null;
  }
}

const check = (label, condition, detail = "") =>
  results.push({ name: `↳ ${label}`, status: condition ? "ok" : "FAIL", detail: condition ? "" : detail });

// --- 1. Metadata objects ----------------------------------------------------
const tag = await call("create_tag", { name: `${PREFIX}-tag`, color: "#ff8800", matching_algorithm: 0 });
if (tag?.id) created.tags.push(tag.id);

const correspondent = await call("create_correspondent", { name: `${PREFIX}-korrespondent`, matching_algorithm: 0 });
if (correspondent?.id) created.correspondents.push(correspondent.id);

const documentType = await call("create_document_type", { name: `${PREFIX}-typ`, matching_algorithm: 0 });
if (documentType?.id) created.documentTypes.push(documentType.id);

const customField = await call("create_custom_field", { name: `${PREFIX}-feld`, data_type: "string" });
if (customField?.id) created.customFields.push(customField.id);

// --- 2. Upload --------------------------------------------------------------
const upload = await call("upload_document", {
  path: FIXTURE,
  filename: `${PREFIX}-sample.pdf`,
  title: `${PREFIX} upload`,
});
check("upload returned a task id", Boolean(upload?.task_id), JSON.stringify(upload)?.slice(0, 120));

// Consumption is asynchronous — poll the task list for the resulting document.
let documentId = null;
for (let attempt = 0; attempt < 30 && !documentId; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2000));
  const tasks = await client
    .callTool({ name: "list_tasks", arguments: { task_id: upload?.task_id, page_size: 5, full: true } })
    .then((r) => JSON.parse(r.content[0].text))
    .catch(() => null);
  const task = tasks?.results?.[0];
  // Paperless reports task status lower-case, and the new document's id arrives
  // in related_document_ids / result_data — not in a `related_document` field.
  if (task?.status === "success") {
    documentId = task.related_document_ids?.[0] ?? task.result_data?.document_id ?? null;
  }
  if (task?.status === "failure") {
    check("consumption succeeded", false, JSON.stringify(task.result_data ?? task).slice(0, 160));
    break;
  }
}
check("document was consumed", Boolean(documentId), "consumer did not finish within 60s");
if (documentId) created.documents.push(documentId);

if (documentId) {
  // --- 3. Update every field type ------------------------------------------
  await call("update_document", {
    id: documentId,
    title: `${PREFIX} renamed`,
    correspondent: correspondent?.id,
    document_type: documentType?.id,
    tags: tag ? [tag.id] : [],
    created_date: "2024-03-15",
    custom_fields: customField ? [{ field: customField.id, value: "TEST-0001" }] : [],
  });

  // The old fork sent correspondent/document_type as strings and Paperless
  // rejected them. Read the document back rather than trusting the 200.
  const readBack = await call("get_document", { id: documentId });
  check("title was applied", readBack?.title === `${PREFIX} renamed`, String(readBack?.title));
  check("correspondent was applied", readBack?.correspondent === correspondent?.id, String(readBack?.correspondent));
  check("document_type was applied", readBack?.document_type === documentType?.id, String(readBack?.document_type));
  // An instance may run workflows that attach their own tags on consumption,
  // so assert our tag is present rather than that it is the only one.
  check("tag was applied", (readBack?.tags ?? []).includes(tag?.id), JSON.stringify(readBack?.tags));
  check("created_date was applied", String(readBack?.created_date).startsWith("2024-03-15"), String(readBack?.created_date));
  check("custom field was applied", JSON.stringify(readBack?.custom_fields ?? []).includes("TEST-0001"), JSON.stringify(readBack?.custom_fields));

  // --- 4. Notes -------------------------------------------------------------
  await call("create_document_note", { id: documentId, note: `${PREFIX} note` });
  const notes = await call("list_document_notes", { id: documentId });
  const noteId = Array.isArray(notes) ? notes[0]?.id : notes?.[0]?.id;
  check("note was created", Boolean(noteId), JSON.stringify(notes)?.slice(0, 120));
  if (noteId) await call("delete_document_note", { id: documentId, note_id: noteId });

  // --- 5. Bulk edit ---------------------------------------------------------
  await call("bulk_edit_documents", { documents: [documentId], method: "remove_tag", tag: tag?.id });
  const afterRemove = await call("get_document", { id: documentId });
  check("bulk remove_tag worked", !(afterRemove?.tags ?? []).includes(tag?.id), JSON.stringify(afterRemove?.tags));

  await call("bulk_edit_documents", { documents: [documentId], method: "add_tag", tag: tag?.id });
  const afterAdd = await call("get_document", { id: documentId });
  check("bulk add_tag worked", (afterAdd?.tags ?? []).includes(tag?.id), JSON.stringify(afterAdd?.tags));

  // --- 6. Share link --------------------------------------------------------
  const share = await call("create_share_link", { document: documentId, file_version: "original" });
  check("share link has a url", typeof share?.url === "string" && share.url.includes("/share/"), String(share?.url));
  if (share?.id) await call("delete_share_link", { id: share.id });

  // --- 7. Rotation ----------------------------------------------------------
  await call("rotate_documents", { documents: [documentId], degrees: 90 });

  // --- 8. Trash round trip --------------------------------------------------
  await call("delete_document", { id: documentId });
  const trash = await call("list_trash", { page_size: 50 });
  check(
    "document is in the trash",
    JSON.stringify(trash?.results ?? []).includes(`"id":${documentId}`),
    `${trash?.count} items in trash`,
  );
  await call("restore_from_trash", { documents: [documentId] });
  const restored = await call("get_document", { id: documentId });
  check("document was restored", restored?.id === documentId, JSON.stringify(restored)?.slice(0, 120));
}

// --- 9. Read-only mode must refuse writes -----------------------------------
{
  const roTransport = new StdioClientTransport({
    command: process.execPath,
    args: [join(root, "build", "index.js")],
    env: { ...process.env, PAPERLESS_TOOLSETS: "all", PAPERLESS_READ_ONLY: "1" },
    stderr: "ignore",
  });
  const ro = new Client({ name: "write-test-ro", version: "1.0.0" });
  await ro.connect(roTransport);
  const { tools } = await ro.listTools();
  const names = tools.map((t) => t.name);
  check("read-only mode hides create_tag", !names.includes("create_tag"));
  check("read-only mode hides delete_document", !names.includes("delete_document"));
  check("read-only mode keeps search_documents", names.includes("search_documents"));
  await ro.close();
}

// --- 10. Cleanup ------------------------------------------------------------
if (keep) {
  console.log("--keep given: leaving test objects in place.\n");
} else {
  for (const id of created.documents) {
    await call("delete_document", { id });
    await call("empty_trash", { documents: [id] });
  }
  for (const id of created.tags) await call("delete_tag", { id });
  for (const id of created.correspondents) await call("delete_correspondent", { id });
  for (const id of created.documentTypes) await call("delete_document_type", { id });
  for (const id of created.customFields) await call("delete_custom_field", { id });

  // Prove the cleanup actually happened.
  const leftovers = await call("global_search", { query: PREFIX });
  const remaining = Object.entries(leftovers ?? {})
    .filter(([key, value]) => key !== "total" && Array.isArray(value) && value.length > 0)
    .map(([key, value]) => `${key}:${value.length}`);
  check("no test objects left behind", remaining.length === 0, remaining.join(", "));
}

await client.close();

const failed = results.filter((r) => r.status !== "ok");
const width = Math.max(...results.map((r) => r.name.length));
for (const r of results) {
  console.log(`${r.status === "ok" ? "✔" : "✘"} ${r.name.padEnd(width)}  ${r.detail}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (created.documents.length > 0) console.log(`Test document id: ${created.documents.join(", ")}`);
process.exit(failed.length > 0 ? 1 : 0);
