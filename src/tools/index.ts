import type { Config } from "../config.js";
import { adminTools } from "./admin.js";
import { bulkTools } from "./bulk.js";
import { customFieldTools } from "./customfields.js";
import { documentTools } from "./documents.js";
import { fileTools } from "./files.js";
import { mailTools } from "./mail.js";
import { metadataTools } from "./metadata.js";
import { sharingTools } from "./sharing.js";
import { systemTools } from "./system.js";
import type { ToolDefinition } from "./types.js";
import { viewTools } from "./views.js";
import { workflowTools } from "./workflows.js";

/** Every tool this server knows about, before any filtering. */
export const ALL_TOOLS: ToolDefinition[] = [
  ...documentTools,
  ...bulkTools,
  ...fileTools,
  ...metadataTools,
  ...customFieldTools,
  ...viewTools,
  ...sharingTools,
  ...workflowTools,
  ...mailTools,
  ...adminTools,
  ...systemTools,
];

/** Tools enabled by the given configuration. */
export function selectTools(config: Config): ToolDefinition[] {
  const enabled = new Set<string>(config.toolsets);
  return ALL_TOOLS.filter((tool) => {
    if (!enabled.has(tool.toolset)) return false;
    if (config.readOnly && !tool.readOnly) return false;
    return true;
  });
}

export type { ToolDefinition };
