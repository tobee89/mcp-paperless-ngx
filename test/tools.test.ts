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
