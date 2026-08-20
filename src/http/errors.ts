/** Raised when Paperless answers with a non-2xx status. */
export class PaperlessApiError extends Error {
  constructor(
    readonly status: number,
    readonly method: string,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(PaperlessApiError.describe(status, method, path, body));
    this.name = "PaperlessApiError";
  }

  private static describe(
    status: number,
    method: string,
    path: string,
    body: unknown,
  ): string {
    const hint = HINTS[status];
    const detail = PaperlessApiError.detail(body);
    return [
      `Paperless returned ${status} for ${method} ${path}.`,
      detail && `Response: ${detail}`,
      hint && `Hint: ${hint}`,
    ]
      .filter(Boolean)
      .join(" ");
  }

  /** DRF reports validation errors as {field: [messages]} — flatten that for the model. */
  private static detail(body: unknown): string {
    if (body == null) return "";
    if (typeof body === "string") return body.slice(0, 800);
    if (typeof body !== "object") return String(body);

    const record = body as Record<string, unknown>;
    if (typeof record.detail === "string") return record.detail;

    const parts: string[] = [];
    for (const [field, value] of Object.entries(record)) {
      const text = Array.isArray(value) ? value.join("; ") : String(value);
      parts.push(`${field}: ${text}`);
    }
    return parts.join(" | ").slice(0, 800);
  }
}

const HINTS: Record<number, string> = {
  400: "The request was rejected as invalid — check field names, IDs and value types.",
  401: "Authentication failed. Verify PAPERLESS_TOKEN is a current API token.",
  403: "Authenticated but not permitted. The token's user lacks permission for this object, or a forward-auth proxy blocked the call (see PAPERLESS_HEADERS).",
  404: "Not found. The object may have been deleted, or the URL path is wrong for this Paperless version.",
  405: "Method not allowed on this endpoint for your Paperless version.",
  406: "The server rejected the requested API version. Try lowering PAPERLESS_API_VERSION.",
  413: "Payload too large — the upload exceeds the server or proxy limit.",
  500: "Paperless hit an internal error. Check the Paperless container logs.",
};

/** Raised when the instance cannot be reached at all. */
export class PaperlessConnectionError extends Error {
  constructor(url: string, cause: unknown) {
    const reason = cause instanceof Error ? cause.message : String(cause);
    super(
      `Could not reach Paperless at ${url}: ${reason}. ` +
        `Check PAPERLESS_URL, network/VPN reachability and any reverse proxy in front of the instance.`,
    );
    this.name = "PaperlessConnectionError";
    this.cause = cause;
  }
}

/** Raised when a write is attempted while the server runs read-only. */
export class ReadOnlyError extends Error {
  constructor(tool: string) {
    super(
      `Refusing to run "${tool}": this MCP server is configured read-only (PAPERLESS_READ_ONLY). ` +
        `Restart it without that setting to allow writes.`,
    );
    this.name = "ReadOnlyError";
  }
}
