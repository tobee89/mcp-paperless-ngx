import { tmpdir } from "node:os";
import { z } from "zod";

/** Every tool belongs to exactly one toolset. Operators enable only what they need. */
export const TOOLSETS = [
  "documents",
  "metadata",
  "customfields",
  "views",
  "sharing",
  "workflows",
  "mail",
  "admin",
  "system",
] as const;

export type Toolset = (typeof TOOLSETS)[number];

/** Enabled unless the operator narrows it down. `admin` and `mail` are opt-in. */
export const DEFAULT_TOOLSETS: Toolset[] = [
  "documents",
  "metadata",
  "customfields",
  "views",
  "sharing",
  "workflows",
  "system",
];

const csv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

const bool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
};

export interface Config {
  /** Base URL the server talks to, without trailing slash. */
  baseUrl: string;
  /** Base URL used when building links for the human, e.g. behind a reverse proxy. */
  publicUrl: string;
  token: string;
  toolsets: Toolset[];
  readOnly: boolean;
  /** Extra headers, e.g. for forward-auth setups (Authentik, Authelia). */
  headers: Record<string, string>;
  timeoutMs: number;
  /** Paperless REST API version requested via the Accept header. */
  apiVersion: number;
  /** Max items returned by a single list call before the server truncates. */
  maxPageSize: number;
  /** Directory downloaded files are written to. */
  downloadDir: string;
}

export class ConfigError extends Error {}

const parseHeaders = (raw: string | undefined): Record<string, string> => {
  if (!raw) return {};
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      const shape = z.record(z.string(), z.string()).safeParse(parsed);
      if (!shape.success) throw new Error("values must be strings");
      return shape.data;
    } catch (error) {
      throw new ConfigError(
        `PAPERLESS_HEADERS is not valid JSON object of string values: ${(error as Error).message}`,
      );
    }
  }
  // Fallback syntax: "X-One: a, X-Two: b"
  const out: Record<string, string> = {};
  for (const pair of csv(trimmed)) {
    const index = pair.indexOf(":");
    if (index === -1) {
      throw new ConfigError(`PAPERLESS_HEADERS entry "${pair}" is missing a colon`);
    }
    out[pair.slice(0, index).trim()] = pair.slice(index + 1).trim();
  }
  return out;
};

export interface CliOverrides {
  baseUrl?: string;
  token?: string;
  publicUrl?: string;
  toolsets?: string;
  readOnly?: boolean;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  overrides: CliOverrides = {},
): Config {
  const baseUrlRaw = overrides.baseUrl ?? env.PAPERLESS_URL;
  if (!baseUrlRaw) {
    throw new ConfigError(
      "PAPERLESS_URL is not set. Point it at your Paperless-ngx instance, e.g. https://paperless.example.com",
    );
  }

  let baseUrl: string;
  try {
    baseUrl = new URL(baseUrlRaw).toString().replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`PAPERLESS_URL is not a valid URL: ${baseUrlRaw}`);
  }

  const token = overrides.token ?? env.PAPERLESS_TOKEN ?? env.PAPERLESS_API_KEY;
  if (!token) {
    throw new ConfigError(
      "PAPERLESS_TOKEN is not set. Create one in Paperless under My Profile -> API Auth Token.",
    );
  }

  const requested = csv(overrides.toolsets ?? env.PAPERLESS_TOOLSETS);
  let toolsets: Toolset[];
  if (requested.length === 0) {
    toolsets = [...DEFAULT_TOOLSETS];
  } else if (requested.includes("all")) {
    toolsets = [...TOOLSETS];
  } else {
    const unknown = requested.filter((name) => !TOOLSETS.includes(name as Toolset));
    if (unknown.length > 0) {
      throw new ConfigError(
        `Unknown toolset(s): ${unknown.join(", ")}. Valid: ${TOOLSETS.join(", ")}, all`,
      );
    }
    toolsets = requested as Toolset[];
  }

  const timeoutRaw = env.PAPERLESS_TIMEOUT_MS;
  const timeoutMs = timeoutRaw ? Number(timeoutRaw) : 60_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ConfigError(`PAPERLESS_TIMEOUT_MS must be a positive number, got: ${timeoutRaw}`);
  }

  const maxPageSizeRaw = env.PAPERLESS_MAX_PAGE_SIZE;
  const maxPageSize = maxPageSizeRaw ? Number(maxPageSizeRaw) : 100;
  if (!Number.isInteger(maxPageSize) || maxPageSize <= 0) {
    throw new ConfigError(
      `PAPERLESS_MAX_PAGE_SIZE must be a positive integer, got: ${maxPageSizeRaw}`,
    );
  }

  const publicUrlRaw = overrides.publicUrl ?? env.PAPERLESS_PUBLIC_URL ?? baseUrl;
  let publicUrl: string;
  try {
    publicUrl = new URL(publicUrlRaw).toString().replace(/\/+$/, "");
  } catch {
    throw new ConfigError(`PAPERLESS_PUBLIC_URL is not a valid URL: ${publicUrlRaw}`);
  }

  return {
    baseUrl,
    publicUrl,
    token,
    toolsets,
    readOnly: overrides.readOnly ?? bool(env.PAPERLESS_READ_ONLY),
    headers: parseHeaders(env.PAPERLESS_HEADERS),
    timeoutMs,
    apiVersion: Number(env.PAPERLESS_API_VERSION ?? 10),
    maxPageSize,
    downloadDir: env.PAPERLESS_DOWNLOAD_DIR ?? tmpdir(),
  };
}
