#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { ConfigError, TOOLSETS, loadConfig, type CliOverrides } from "./config.js";
import { PaperlessClient } from "./http/client.js";
import { SERVER_VERSION, buildServer } from "./server.js";

const USAGE = `mcp-paperless-ngx ${SERVER_VERSION}

An MCP server for Paperless-ngx 3.x.

Usage:
  mcp-paperless-ngx [options]

Options:
  --url <url>          Paperless base URL          (env PAPERLESS_URL)
  --token <token>      API token                   (env PAPERLESS_TOKEN)
  --public-url <url>   URL used when building links (env PAPERLESS_PUBLIC_URL)
  --toolsets <list>    Comma-separated, or "all"   (env PAPERLESS_TOOLSETS)
  --read-only          Expose only read operations (env PAPERLESS_READ_ONLY)
  --check              Verify connectivity and exit
  --list-tools         Print the enabled tools and exit
  -h, --help           Show this help

Toolsets: ${TOOLSETS.join(", ")}

Further environment variables:
  PAPERLESS_HEADERS        Extra request headers, JSON object or "Name: value, ..."
                           (needed behind forward-auth proxies such as Authentik)
  PAPERLESS_DOWNLOAD_DIR   Where downloaded files are written (default: system temp)
  PAPERLESS_MAX_PAGE_SIZE  Ceiling for list page sizes (default: 100)
  PAPERLESS_TIMEOUT_MS     Request timeout (default: 60000)
  PAPERLESS_API_VERSION    REST API version to request (default: 10)
`;

function parseArgs(argv: string[]): { overrides: CliOverrides; mode: "run" | "check" | "list" | "help" } {
  const overrides: CliOverrides = {};
  let mode: "run" | "check" | "list" | "help" = "run";

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    switch (arg) {
      case "--url":
      case "--baseUrl":
        overrides.baseUrl = next();
        break;
      case "--token":
        overrides.token = next();
        break;
      case "--public-url":
      case "--publicUrl":
        overrides.publicUrl = next();
        break;
      case "--toolsets":
        overrides.toolsets = next();
        break;
      case "--read-only":
        overrides.readOnly = true;
        break;
      case "--check":
        mode = "check";
        break;
      case "--list-tools":
        mode = "list";
        break;
      case "-h":
      case "--help":
        mode = "help";
        break;
      default:
        if (arg.startsWith("--")) {
          process.stderr.write(`Unknown option: ${arg}\n\n${USAGE}`);
          process.exit(2);
        }
    }
  }
  return { overrides, mode };
}

async function main(): Promise<void> {
  const { overrides, mode } = parseArgs(process.argv.slice(2));

  if (mode === "help") {
    process.stdout.write(USAGE);
    return;
  }

  let config;
  try {
    config = loadConfig(process.env, overrides);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n\n${USAGE}`);
      process.exit(2);
    }
    throw error;
  }

  const { server, toolCount } = buildServer(config);

  if (mode === "list") {
    const { selectTools } = await import("./tools/index.js");
    for (const tool of selectTools(config)) {
      const flags = [tool.readOnly ? "read" : "write", tool.destructive ? "destructive" : ""]
        .filter(Boolean)
        .join(",");
      process.stdout.write(`${tool.name.padEnd(32)} ${tool.toolset.padEnd(14)} ${flags}\n`);
    }
    process.stdout.write(`\n${toolCount} tools enabled.\n`);
    return;
  }

  if (mode === "check") {
    const client = new PaperlessClient(config);
    const stats = await client.get<Record<string, unknown>>("/api/statistics/");
    process.stdout.write(
      `Connected to ${config.baseUrl}. Documents: ${stats.documents_total ?? "?"}, ` +
        `inbox: ${stats.documents_inbox ?? "?"}. ${toolCount} tools enabled ` +
        `(${config.toolsets.join(", ")}${config.readOnly ? ", read-only" : ""}).\n`,
    );
    return;
  }

  // stdout is the MCP channel — every diagnostic must go to stderr.
  process.stderr.write(
    `${config.readOnly ? "[read-only] " : ""}mcp-paperless-ngx ${SERVER_VERSION} ready: ` +
      `${toolCount} tools (${config.toolsets.join(", ")}) against ${config.baseUrl}\n`,
  );

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  process.stderr.write(`Fatal: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
