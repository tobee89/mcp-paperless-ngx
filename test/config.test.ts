import assert from "node:assert/strict";
import { test } from "node:test";
import { ConfigError, DEFAULT_TOOLSETS, loadConfig } from "../src/config.js";

const base = { PAPERLESS_URL: "https://paperless.example.com/", PAPERLESS_TOKEN: "abc" };

test("requires a URL and a token", () => {
  assert.throws(() => loadConfig({}), ConfigError);
  assert.throws(() => loadConfig({ PAPERLESS_URL: base.PAPERLESS_URL }), ConfigError);
});

test("strips the trailing slash from URLs", () => {
  assert.equal(loadConfig(base).baseUrl, "https://paperless.example.com");
});

test("falls back to the base URL for link building", () => {
  assert.equal(loadConfig(base).publicUrl, "https://paperless.example.com");
  assert.equal(
    loadConfig({ ...base, PAPERLESS_PUBLIC_URL: "https://docs.example.com" }).publicUrl,
    "https://docs.example.com",
  );
});

test("accepts PAPERLESS_API_KEY as an alias for the token", () => {
  assert.equal(loadConfig({ PAPERLESS_URL: base.PAPERLESS_URL, PAPERLESS_API_KEY: "k" }).token, "k");
});

test("admin and mail are opt-in", () => {
  const config = loadConfig(base);
  assert.deepEqual(config.toolsets, DEFAULT_TOOLSETS);
  assert.ok(!config.toolsets.includes("admin"));
  assert.ok(!config.toolsets.includes("mail"));
});

test("'all' enables every toolset", () => {
  assert.ok(loadConfig({ ...base, PAPERLESS_TOOLSETS: "all" }).toolsets.includes("admin"));
});

test("rejects unknown toolsets instead of silently ignoring them", () => {
  assert.throws(() => loadConfig({ ...base, PAPERLESS_TOOLSETS: "documents,nonsense" }), ConfigError);
});

test("parses headers as JSON or as a name: value list", () => {
  assert.deepEqual(
    loadConfig({ ...base, PAPERLESS_HEADERS: '{"X-Auth":"a"}' }).headers,
    { "X-Auth": "a" },
  );
  assert.deepEqual(
    loadConfig({ ...base, PAPERLESS_HEADERS: "X-One: a, X-Two: b" }).headers,
    { "X-One": "a", "X-Two": "b" },
  );
  assert.throws(() => loadConfig({ ...base, PAPERLESS_HEADERS: "broken" }), ConfigError);
});

test("read-only mode is off unless asked for", () => {
  assert.equal(loadConfig(base).readOnly, false);
  assert.equal(loadConfig({ ...base, PAPERLESS_READ_ONLY: "true" }).readOnly, true);
  assert.equal(loadConfig({ ...base, PAPERLESS_READ_ONLY: "0" }).readOnly, false);
});
