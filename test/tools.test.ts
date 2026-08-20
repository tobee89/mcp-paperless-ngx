import assert from "node:assert/strict";
import { test } from "node:test";
import { loadConfig } from "../src/config.js";
import { slimDocument } from "../src/format.js";
import { ALL_TOOLS, selectTools } from "../src/tools/index.js";

const base = { PAPERLESS_URL: "https://paperless.example.com", PAPERLESS_TOKEN: "abc" };

test("tool names are unique", () => {
  const names = ALL_TOOLS.map((tool) => tool.name);
  assert.equal(new Set(names).size, names.length);
});

test("every tool has a description that says more than its name", () => {
  for (const tool of ALL_TOOLS) {
    assert.ok(tool.description.length > 40, `${tool.name} needs a real description`);
  }
});

test("destructive tools are never marked read-only", () => {
  for (const tool of ALL_TOOLS) {
    if (tool.destructive) assert.equal(tool.readOnly, false, `${tool.name}`);
  }
});

test("read-only mode removes every write tool", () => {
  const tools = selectTools(loadConfig({ ...base, PAPERLESS_TOOLSETS: "all", PAPERLESS_READ_ONLY: "1" }));
  assert.ok(tools.length > 0);
  assert.ok(tools.every((tool) => tool.readOnly));
  assert.ok(!tools.some((tool) => tool.name === "empty_trash"));
});

test("toolset selection is honoured", () => {
  const tools = selectTools(loadConfig({ ...base, PAPERLESS_TOOLSETS: "metadata" }));
  assert.ok(tools.every((tool) => tool.toolset === "metadata"));
  assert.ok(tools.some((tool) => tool.name === "list_tags"));
});

test("slimDocument drops the OCR text but keeps its size", () => {
  const slim = slimDocument({ id: 1, title: "Rechnung", content: "x".repeat(50_000), tags: [1, 2] });
  assert.equal(slim.content, undefined);
  assert.equal(slim.content_length, 50_000);
  assert.equal(slim.title, "Rechnung");
  assert.deepEqual(slim.tags, [1, 2]);
});

test("slimDocument returns a preview only when asked", () => {
  const slim = slimDocument({ id: 1, content: "abcdef" }, { contentPreview: 3 });
  assert.equal(slim.content_preview, "abc");
  assert.equal(slim.content_truncated, true);
});

test("no list tool hands the raw API response straight through", async () => {
  const { readFile, readdir } = await import("node:fs/promises");
  const dir = new URL("../src/tools/", import.meta.url).pathname;
  const offenders: string[] = [];
  for (const name of await readdir(dir)) {
    if (!name.endsWith(".ts")) continue;
    const source = await readFile(dir + name, "utf8");
    if (source.includes("page(result, result.results")) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    `These modules return unfiltered API objects, which is how OCR text and 30-field ` +
      `workflow definitions leak into the context: ${offenders.join(", ")}`,
  );
});

test("summarise collapses nested objects and truncates long strings", async () => {
  const { summarise } = await import("../src/format.js");
  const [row] = summarise(
    [{ id: 1, name: "x", triggers: [{ a: 1 }, { b: 2 }], match: "y".repeat(500), skip: "no" }],
    ["id", "name", "triggers", "match"],
  );
  assert.equal(row.triggers, 2, "nested objects collapse to a count");
  assert.equal(String(row.match).length, 301, "long strings are truncated");
  assert.equal(row.skip, undefined, "unlisted fields are dropped");
  const [fullRow] = summarise([{ id: 1, skip: "yes" }], ["id"], true);
  assert.equal(fullRow.skip, "yes", "full=true returns everything");
});
