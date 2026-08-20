import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { ALL_TOOLS } from "../src/tools/index.js";

/**
 * Not every MCP client sends JSON types faithfully. Some serialise numbers and
 * booleans as strings, which a strict schema rejects with "expected number,
 * received string" — a failure that never shows up in tests that speak the
 * protocol correctly, only in front of real users.
 *
 * These tests feed every scalar parameter the string form of a *valid* value
 * and require it to be accepted.
 */

/** A value the parameter should accept, derived from its own JSON Schema. */
function validSample(def: Record<string, any>): number | boolean | undefined {
  const branch = def.anyOf?.find((b: any) => b.type && b.type !== "null") ?? def;
  const type = branch.type;

  if (type === "boolean") return true;
  if (type !== "integer" && type !== "number") return undefined;

  if (Array.isArray(branch.enum)) return branch.enum[0];
  // refine()-based enums keep their bounds off the schema, so probe the middle.
  const min = typeof branch.minimum === "number" ? branch.minimum : 1;
  const max = typeof branch.maximum === "number" ? branch.maximum : min + 1;
  return Math.min(Math.max(min, 1), max);
}

test("every scalar parameter accepts the string form of a valid value", () => {
  const rejected: string[] = [];
  let checked = 0;

  for (const tool of ALL_TOOLS) {
    const shape = tool.inputSchema as z.ZodRawShape;
    const schema: any = z.toJSONSchema(z.object(shape), { io: "input", unrepresentable: "any" });

    for (const [name, def] of Object.entries<any>(schema.properties ?? {})) {
      const value = validSample(def);
      if (value === undefined) continue;

      const field = (shape as Record<string, z.ZodType>)[name];
      // Sanity check: the value must be valid in its native form first,
      // otherwise a rejection says nothing about string handling.
      if (!field.safeParse(value).success) continue;

      checked += 1;
      if (!field.safeParse(String(value)).success) {
        rejected.push(`${tool.name}.${name} rejects ${JSON.stringify(String(value))}`);
      }
    }
  }

  assert.ok(checked > 100, `expected to check many parameters, only saw ${checked}`);
  assert.deepEqual(
    rejected,
    [],
    `Use the helpers in src/tools/scalars.ts (int/id/bool/nullableInt/intEnum) for these:\n${rejected.join("\n")}`,
  );
});

test("clearing a field with null is not coerced to zero", () => {
  const update = ALL_TOOLS.find((tool) => tool.name === "update_document")!;
  const shape = update.inputSchema as z.ZodRawShape;

  for (const field of ["correspondent", "document_type", "storage_path"]) {
    const parsed = shape[field].safeParse(null);
    assert.ok(parsed.success, `${field} must accept null to clear the value`);
    assert.equal(parsed.data, null, `${field}: null must stay null, not become 0`);
  }
});

test("boolean strings are read by value, not by truthiness", () => {
  const search = ALL_TOOLS.find((tool) => tool.name === "search_documents")!;
  const field = (search.inputSchema as z.ZodRawShape).is_in_inbox;

  assert.equal(field.safeParse("false").data, false, '"false" must not be truthy');
  assert.equal(field.safeParse("true").data, true);
  assert.equal(field.safeParse("0").data, false);
});
