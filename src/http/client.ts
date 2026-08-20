import type { Config } from "../config.js";
import { PaperlessApiError, PaperlessConnectionError } from "./errors.js";

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
  /** Only present on full-text search responses. */
  all?: number[];
}

export interface BinaryResult {
  data: Buffer;
  contentType: string;
  filename?: string;
}

export type QueryValue = string | number | boolean | null | undefined | Array<string | number>;
export type Query = Record<string, QueryValue>;

const isPage = (value: unknown): value is Page<unknown> =>
  typeof value === "object" &&
  value !== null &&
  "results" in value &&
  Array.isArray((value as { results: unknown }).results);

/**
 * Thin typed wrapper around the Paperless-ngx REST API.
 *
 * Deliberately built on global fetch — no HTTP client dependency, so the
 * published package stays small and free of transitive supply-chain risk.
 */
export class PaperlessClient {
  constructor(private readonly config: Config) {}

  get publicUrl(): string {
    return this.config.publicUrl;
  }

  /** Browser URL for a document, for handing back to the human. */
  documentUrl(id: number): string {
    return `${this.config.publicUrl}/documents/${id}/details`;
  }

  private url(path: string, query?: Query): string {
    const normalised = path.startsWith("/") ? path : `/${path}`;
    const url = new URL(this.config.baseUrl + normalised);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value === undefined || value === null || value === "") continue;
      if (Array.isArray(value)) {
        // Paperless expects repeated keys for multi-value filters (e.g. tags__id__in).
        for (const item of value) url.searchParams.append(key, String(item));
      } else {
        url.searchParams.set(key, String(value));
      }
    }
    return url.toString();
  }

  private headers(extra?: Record<string, string>): Record<string, string> {
    return {
      Authorization: `Token ${this.config.token}`,
      Accept: `application/json; version=${this.config.apiVersion}`,
      ...this.config.headers,
      ...extra,
    };
  }

  private async send(
    method: string,
    path: string,
    init: { query?: Query; body?: BodyInit; headers?: Record<string, string> } = {},
  ): Promise<Response> {
    const url = this.url(path, init.query);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: this.headers(init.headers),
        body: init.body,
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      throw new PaperlessConnectionError(url, error);
    }

    if (!response.ok) {
      const raw = await response.text();
      let parsed: unknown = raw;
      try {
        parsed = JSON.parse(raw);
      } catch {
        /* keep the raw text */
      }
      throw new PaperlessApiError(response.status, method, path, parsed);
    }
    return response;
  }

  private async json<T>(
    method: string,
    path: string,
    init: { query?: Query; payload?: unknown } = {},
  ): Promise<T> {
    const hasPayload = init.payload !== undefined;
    const response = await this.send(method, path, {
      query: init.query,
      body: hasPayload ? JSON.stringify(init.payload) : undefined,
      headers: hasPayload ? { "Content-Type": "application/json" } : undefined,
    });
    if (response.status === 204) return undefined as T;
    const text = await response.text();
    if (text === "") return undefined as T;
    return JSON.parse(text) as T;
  }

  get<T>(path: string, query?: Query): Promise<T> {
    return this.json<T>("GET", path, { query });
  }

  post<T>(path: string, payload?: unknown, query?: Query): Promise<T> {
    return this.json<T>("POST", path, { payload, query });
  }

  patch<T>(path: string, payload: unknown, query?: Query): Promise<T> {
    return this.json<T>("PATCH", path, { payload, query });
  }

  put<T>(path: string, payload: unknown, query?: Query): Promise<T> {
    return this.json<T>("PUT", path, { payload, query });
  }

  async delete(path: string, query?: Query): Promise<void> {
    await this.json<void>("DELETE", path, { query });
  }

  /** One page of a list endpoint, with the page size clamped to the configured ceiling. */
  async list<T>(path: string, query: Query = {}): Promise<Page<T>> {
    const requested = Number(query.page_size ?? this.config.maxPageSize);
    const pageSize = Math.min(
      Number.isFinite(requested) && requested > 0 ? requested : this.config.maxPageSize,
      this.config.maxPageSize,
    );
    const result = await this.get<Page<T>>(path, { ...query, page_size: pageSize });
    if (!isPage(result)) {
      throw new Error(`Expected a paginated response from ${path} but got something else.`);
    }
    return result;
  }

  /**
   * Every item of a list endpoint, following pagination.
   *
   * Only for small reference collections (tags, correspondents, document types).
   * Never call this for documents — that would drag an entire archive into the
   * model's context.
   */
  async listAll<T>(path: string, query: Query = {}, hardLimit = 5_000): Promise<T[]> {
    const items: T[] = [];
    let page = 1;
    for (;;) {
      const chunk = await this.list<T>(path, { ...query, page });
      items.push(...chunk.results);
      if (!chunk.next || items.length >= hardLimit) break;
      page += 1;
    }
    return items.slice(0, hardLimit);
  }

  /** Fetch a file (download, preview, thumbnail, bulk archive). */
  async binary(path: string, query?: Query): Promise<BinaryResult> {
    const response = await this.send("GET", path, { query });
    const buffer = Buffer.from(await response.arrayBuffer());
    const disposition = response.headers.get("content-disposition") ?? "";
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    return {
      data: buffer,
      contentType: response.headers.get("content-type") ?? "application/octet-stream",
      filename: match ? decodeURIComponent(match[1]) : undefined,
    };
  }

  /** Multipart upload — used by the document consumption endpoint. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    const response = await this.send("POST", path, { body: form });
    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      // post_document historically answers with a bare quoted task UUID.
      return text.replace(/^"|"$/g, "") as T;
    }
  }
}
