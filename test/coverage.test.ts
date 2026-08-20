import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import index from "../schema/endpoints.json" with { type: "json" };
import { COMPUTED_ENDPOINTS, EXCLUDED_ENDPOINTS } from "../src/tools/coverage.js";

const SRC = new URL("../src/", import.meta.url).pathname;

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await sourceFiles(full)));
    // coverage.ts is the bookkeeping file itself — scanning it would let every
    // excluded endpoint count as "reached".
    else if (entry.name.endsWith(".ts") && entry.name !== "coverage.ts") files.push(full);
  }
  return files;
}

/** Turn "/api/documents/${args.id}/notes/" into the schema's "/api/documents/{id}/notes/". */
const normalise = (path: string): string =>
  path.replace(/\$\{[^}]+\}/g, "{id}").replace(/\/{2,}/g, "/");

async function usedPaths(): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  for (const file of await sourceFiles(SRC)) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/["'`](\/api\/[^"'`\s]*)["'`]/g)) {
      const path = normalise(match[1]);
      const users = found.get(path) ?? [];
      users.push(file.replace(SRC, ""));
      found.set(path, users);
    }
  }
  return found;
}

const known = new Set(Object.keys(index.endpoints));

/**
 * Guards against the failure mode that quietly breaks every hand-written
 * Paperless client: the API moves, the wrapper keeps calling a path that no
 * longer exists, and nobody notices until a tool call 404s in production.
 */
test("every API path a tool calls exists in the schema", async () => {
  const unknown: string[] = [];
  for (const [path, users] of await usedPaths()) {
    // Paths with a nested {id} the regex cannot disambiguate are checked loosely.
    if (known.has(path)) continue;
    const loose = path.replace(/\{id\}/g, "[^/]+");
    const matches = [...known].some((candidate) =>
      new RegExp(`^${loose.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}$`).test(candidate),
    );
    if (!matches) unknown.push(`${path} (used in ${users.join(", ")})`);
  }
  assert.deepEqual(unknown, [], `Tool code calls paths absent from the schema:\n${unknown.join("\n")}`);
});

test("the endpoint index matches the API version the server requests", () => {
  assert.match(index.api_version, /\(10\)|^10$/, "endpoints.json was generated from a different API version");
});

test("every documented endpoint is either exposed or explicitly excluded", async () => {
  const used = await usedPaths();
  const reachable = new Set<string>([...used.keys(), ...COMPUTED_ENDPOINTS]);

  const covered = [...known].filter((path) => {
    if (reachable.has(path)) return true;
    const pattern = new RegExp(`^${path.replace(/\{[^}]+\}/g, "\\{id\\}")}$`);
    return [...reachable].some((candidate) => pattern.test(candidate));
  });

  const unaccounted = [...known].filter(
    (path) => !covered.includes(path) && !(path in EXCLUDED_ENDPOINTS),
  );

  console.log(
    `Endpoint coverage: ${covered.length} exposed, ${Object.keys(EXCLUDED_ENDPOINTS).length} excluded by design, ` +
      `${known.size} documented.`,
  );

  assert.deepEqual(
    unaccounted,
    [],
    `These endpoints are neither exposed nor listed in EXCLUDED_ENDPOINTS:\n${unaccounted.join("\n")}\n` +
      `Either add a tool for them or record why they are out of scope.`,
  );
});

test("no stale exclusions", () => {
  const stale = Object.keys(EXCLUDED_ENDPOINTS).filter((path) => !known.has(path));
  assert.deepEqual(stale, [], `EXCLUDED_ENDPOINTS lists paths the API no longer has: ${stale.join(", ")}`);
});

/**
 * The path test proves an endpoint exists. It says nothing about whether the
 * values sent to it are accepted — a wrong enum member produces an HTTP 400
 * that looks like a caller error and is nearly impossible to diagnose from the
 * response alone. This caught `status: "SUCCESS"` where Paperless wants
 * "success", which had silently broken every filtered list_tasks call.
 */
test("enum values match the schema exactly", async () => {
  const { SCHEMA_ENUMS } = await import("../src/tools/enums.js");
  const schemaEnums = (index as { enums?: Record<string, Array<string | number>> }).enums ?? {};
  const problems: string[] = [];

  for (const [name, values] of Object.entries(SCHEMA_ENUMS)) {
    const expected = schemaEnums[name];
    if (!expected) {
      problems.push(`${name}: no longer present in the schema`);
      continue;
    }
    const ours = [...values].map(String).sort();
    const theirs = [...expected].map(String).sort();
    if (JSON.stringify(ours) !== JSON.stringify(theirs)) {
      problems.push(`${name}: we use [${ours}], schema says [${theirs}]`);
    }
  }

  assert.deepEqual(problems, [], problems.join("\n"));
});

test("no tool declares a task status the API does not know", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../src/tools/system.ts", import.meta.url).pathname, "utf8");
  assert.ok(
    !/"SUCCESS"|"PENDING"|"FAILURE"/.test(source),
    "Task statuses are lower-case in the Paperless API — upper-case values are silently rejected.",
  );
});
