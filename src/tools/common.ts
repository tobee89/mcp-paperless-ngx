import { z } from "zod";
import type { QueryValue } from "../http/client.js";
import { id, int, intEnum } from "./scalars.js";

/**
 * Paperless matches metadata objects against document text using one of these
 * algorithms. Spelling them out beats making the model guess the integer.
 */
export const matchingAlgorithm = intEnum([0, 1, 2, 3, 4, 5, 6]).describe(
    "Matching algorithm: 0=none, 1=any word, 2=all words, 3=exact, 4=regex, 5=fuzzy, 6=auto. " +
      "Use 6 (auto) unless the user asked for a specific rule.",
  );

export const permissionSet = z
  .object({
    users: z.array(int()).optional(),
    groups: z.array(int()).optional(),
  })
  .describe("User and group IDs.");

export const setPermissions = z
  .object({
    view: permissionSet.optional(),
    change: permissionSet.optional(),
  })
  .describe(
    "Object-level permissions. Overwrites existing permissions entirely unless the endpoint supports merging.",
  );

/** Shared query arguments for every list endpoint. */
export const listArgs = {
  page: int().min(1).default(1).describe("1-based page number."),
  page_size: int()
    .min(1)
    .optional()
    .describe("Items per page. Clamped by the server's configured ceiling."),
  ordering: z
    .string()
    .optional()
    .describe("Field to order by. Prefix with '-' to reverse, e.g. '-created'."),
  name__icontains: z
    .string()
    .optional()
    .describe("Case-insensitive substring filter on the name."),
};

export const idArg = id();

/** Drop undefined keys so PATCH bodies only carry what the caller set. */
export function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as Partial<T>;
}

/** Split tool args into the list-query part and everything else. */
export function listQuery(args: Record<string, unknown>): Record<string, QueryValue> {
  const { page, page_size, ordering, ...rest } = args;
  return compact({ page, page_size, ordering, ...rest }) as Record<string, QueryValue>;
}
