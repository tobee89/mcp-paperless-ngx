import type { z } from "zod";
import type { Config, Toolset } from "../config.js";
import type { PaperlessClient } from "../http/client.js";

export interface ToolContext {
  client: PaperlessClient;
  config: Config;
}

export interface ToolResult {
  [key: string]: unknown;
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource"; resource: { uri: string; mimeType?: string; blob: string } }
  >;
  isError?: boolean;
}

export type ToolShape = z.ZodRawShape;

export interface ToolDefinition<Shape extends ToolShape = ToolShape> {
  name: string;
  title: string;
  /**
   * Written for the model, not for a human reading docs: say what the tool
   * returns, when to prefer it over a sibling, and what it costs.
   */
  description: string;
  toolset: Toolset;
  inputSchema: Shape;
  /** True when the tool only reads. Read-only mode keeps exactly these. */
  readOnly: boolean;
  /** True when the tool can destroy data irreversibly. */
  destructive?: boolean;
  handler: (args: z.infer<z.ZodObject<Shape>>, ctx: ToolContext) => Promise<ToolResult>;
}

/** Helper preserving the shape's type through registration. */
export function defineTool<Shape extends ToolShape>(
  definition: ToolDefinition<Shape>,
): ToolDefinition<ToolShape> {
  return definition as unknown as ToolDefinition<ToolShape>;
}
