import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Config } from "./config.js";
import { failure } from "./format.js";
import { PaperlessClient } from "./http/client.js";
import { PaperlessApiError, PaperlessConnectionError } from "./http/errors.js";
import { PROMPTS } from "./prompts.js";
import { selectTools } from "./tools/index.js";
import type { ToolContext } from "./tools/types.js";

export const SERVER_NAME = "mcp-paperless-ngx";
export const SERVER_VERSION = "0.1.0";

export interface BuiltServer {
  server: McpServer;
  toolCount: number;
}

export function buildServer(config: Config): BuiltServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "Talks to a Paperless-ngx document archive. Two habits keep this usable: resolve names to IDs " +
        "via get_metadata_overview before filing anything, and never pull document text you do not " +
        "need — search_documents returns summaries, get_document_content returns the expensive part. " +
        "Deleting, emptying the trash and creating public share links are irreversible or externally " +
        "visible; confirm those with the user first.",
    },
  );

  const client = new PaperlessClient(config);
  const context: ToolContext = { client, config };
  const tools = selectTools(config);

  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          readOnlyHint: tool.readOnly,
          destructiveHint: Boolean(tool.destructive),
          idempotentHint: tool.readOnly,
          openWorldHint: true,
        },
      },
      async (args: unknown) => {
        try {
          return await tool.handler(args as never, context);
        } catch (error) {
          return failure(describeError(error, tool.name));
        }
      },
    );
  }

  for (const prompt of PROMPTS) {
    server.registerPrompt(
      prompt.name,
      {
        title: prompt.title,
        description: prompt.description,
        argsSchema: prompt.argsSchema as z.ZodRawShape,
      },
      (args: Record<string, unknown>) => ({
        messages: [
          { role: "user" as const, content: { type: "text" as const, text: prompt.build(args ?? {}) } },
        ],
      }),
    );
  }

  return { server, toolCount: tools.length };
}

/**
 * Tool failures are answers, not crashes: the model should see what went wrong
 * and be able to correct itself, so errors come back as readable text rather
 * than tearing down the connection.
 */
function describeError(error: unknown, tool: string): string {
  if (error instanceof PaperlessApiError || error instanceof PaperlessConnectionError) {
    return `${tool} failed. ${error.message}`;
  }
  if (error instanceof z.ZodError) {
    const issues = error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
    return `${tool} received invalid arguments — ${issues.join("; ")}`;
  }
  if (error instanceof Error) return `${tool} failed: ${error.message}`;
  return `${tool} failed: ${String(error)}`;
}
