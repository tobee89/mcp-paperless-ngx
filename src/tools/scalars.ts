import { z } from "zod";

/**
 * Scalar types that survive real MCP clients.
 *
 * Not every client sends JSON types faithfully. Some serialise numbers as
 * strings — `{"correspondent": "10"}` instead of `{"correspondent": 10}` —
 * particularly for parameters whose JSON Schema uses `anyOf`, which several
 * clients flatten to an untyped `{}` and then pass through unconverted.
 *
 * A strict `z.number()` rejects that with "expected number, received string",
 * which looks like a server bug and is impossible for the model to work around.
 * Being liberal in what we accept costs nothing and removes a whole class of
 * failures that only ever appear in production, never in tests that speak the
 * protocol correctly.
 */

/** Integer that also accepts its string form. */
export const int = () => z.coerce.number().int();

/** Positive integer ID, string form accepted. */
export const id = () => z.coerce.number().int().positive();

/**
 * Integer where `null` carries meaning — "clear this field" — so it must not be
 * coerced to 0 the way `z.coerce.number()` would.
 */
export const nullableInt = () =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().int().nullable(),
  );

/**
 * Boolean that tolerates the string forms.
 *
 * `z.coerce.boolean()` is not usable here: it follows JavaScript truthiness, so
 * the string "false" would become `true` — worse than rejecting the input.
 */
export const bool = () =>
  z.preprocess((value) => {
    if (typeof value !== "string") return value;
    const normalised = value.trim().toLowerCase();
    if (["true", "1", "yes"].includes(normalised)) return true;
    if (["false", "0", "no"].includes(normalised)) return false;
    return value;
  }, z.boolean());

/** One of a fixed set of integers, tolerant of the string form. */
export const intEnum = (values: readonly number[]) =>
  z.preprocess(
    (value) => (typeof value === "string" && value.trim() !== "" ? Number(value) : value),
    z.number().refine((value) => values.includes(value), {
      message: `Must be one of: ${values.join(", ")}`,
    }),
  );
