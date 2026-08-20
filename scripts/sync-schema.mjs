#!/usr/bin/env node
/**
 * Refresh schema/endpoints.json from a live Paperless-ngx instance.
 *
 * The endpoint index is what the coverage test checks tool paths against, so
 * re-running this against a newer Paperless is how this server finds out that
 * the API moved — instead of finding out from a user's bug report.
 *
 *   PAPERLESS_URL=... PAPERLESS_TOKEN=... node scripts/sync-schema.mjs
 */
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const baseUrl = (process.env.PAPERLESS_URL ?? "").replace(/\/+$/, "");
const token = process.env.PAPERLESS_TOKEN ?? process.env.PAPERLESS_API_KEY;

if (!baseUrl) {
  console.error("PAPERLESS_URL is required.");
  process.exit(2);
}

const headers = { Accept: "application/json" };
if (token) headers.Authorization = `Token ${token}`;

const response = await fetch(`${baseUrl}/api/schema/?format=json`, { headers });
if (!response.ok) {
  console.error(`Could not fetch the schema: HTTP ${response.status}`);
  process.exit(1);
}

const schema = await response.json();
const methods = ["get", "post", "put", "patch", "delete"];

const endpoints = {};
for (const [path, operations] of Object.entries(schema.paths)) {
  endpoints[path] = methods.filter((method) => method in operations);
}

const index = {
  title: schema.info?.title ?? "Paperless-ngx REST API",
  api_version: schema.info?.version ?? "unknown",
  generated: new Date().toISOString().slice(0, 10),
  endpoints,
};

const target = join(dirname(fileURLToPath(import.meta.url)), "..", "schema", "endpoints.json");
await writeFile(target, `${JSON.stringify(index, null, 2)}\n`);
console.log(
  `Wrote ${Object.keys(endpoints).length} endpoints for API ${index.api_version} to schema/endpoints.json`,
);
