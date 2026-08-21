<p align="center">
  <img src="docs/logo.png" alt="eichner.cloud" width="360">
</p>

<h1 align="center">mcp-paperless-ngx</h1>

<p align="center">
  A <a href="https://modelcontextprotocol.io/">Model Context Protocol</a> server for
  <a href="https://docs.paperless-ngx.com/">Paperless-ngx</a> <strong>3.x</strong><br>
  <em>Full REST API coverage, schema-aware, token-frugal.</em>
</p>

<p align="center">
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-0e94ff?style=flat-square"></a>
  <img alt="Node 20+" src="https://img.shields.io/badge/node-%3E%3D20-0e94ff?style=flat-square">
  <img alt="Paperless-ngx 3.x" src="https://img.shields.io/badge/paperless--ngx-3.x-0e94ff?style=flat-square">
  <img alt="REST API v10" src="https://img.shields.io/badge/REST%20API-v10-0e94ff?style=flat-square">
  <img alt="Endpoint coverage 92/92" src="https://img.shields.io/badge/endpoints-92%2F92%20accounted-0e94ff?style=flat-square">
  <a href="https://glama.ai/mcp/servers/tobee89/mcp-paperless-ngx"><img alt="Glama quality score" src="https://glama.ai/mcp/servers/tobee89/mcp-paperless-ngx/badges/score.svg"></a>
</p>

---

Built against REST API **version 10**, with three things it does differently:

- **Accounted coverage.** Every one of the 92 documented endpoints is either exposed as a tool or
  listed in [`src/tools/coverage.ts`](src/tools/coverage.ts) with a written reason for leaving it
  out. A test enforces this, so a Paperless release that adds an endpoint fails CI instead of
  quietly going unsupported.
- **Token discipline.** A Paperless document carries its full OCR text. Naive wrappers return it by
  default and a single search can exhaust the model's context. Here, list results are trimmed
  server-side via `?fields=`, the text lives behind its own paginated tool, and no list endpoint
  hands the raw API response through — a test enforces that. See [Context cost](#context-cost).
- **Scoped surface.** 99 tools would drown a model's tool list. Toolsets let you expose only what a
  given client needs, and `--read-only` removes every write path entirely.

Paperless-ngx 2.x is not supported: API version 10 introduced endpoints (nested tags, document
versions, `share_link_bundles`, the split PDF operations) that this server assumes exist.

## Quick start

```bash
npx -y mcp-paperless-ngx --check   # verify connectivity, then exit
```

### Claude Code

```bash
claude mcp add paperless --scope user \
  --env PAPERLESS_URL=https://paperless.example.com \
  --env PAPERLESS_TOKEN=your-api-token \
  -- npx -y mcp-paperless-ngx
```

### Claude Desktop, Cursor, Cline, and other MCP clients

```json
{
  "mcpServers": {
    "paperless": {
      "command": "npx",
      "args": ["-y", "mcp-paperless-ngx"],
      "env": {
        "PAPERLESS_URL": "https://paperless.example.com",
        "PAPERLESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Getting an API token

Paperless web UI → your username (top right) → **My Profile** → the circular arrow button next to
the API token field.

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PAPERLESS_URL` | yes | — | Base URL the server talks to. |
| `PAPERLESS_TOKEN` | yes | — | API token. `PAPERLESS_API_KEY` also works. |
| `PAPERLESS_PUBLIC_URL` | no | `PAPERLESS_URL` | URL used when building links for the user, if the instance is reachable under a different name from outside. |
| `PAPERLESS_TOOLSETS` | no | see below | Comma-separated toolsets, or `all`. |
| `PAPERLESS_READ_ONLY` | no | `false` | Expose only tools that cannot change anything. |
| `PAPERLESS_HEADERS` | no | — | Extra request headers, as JSON (`{"X-Auth":"…"}`) or `Name: value, Name: value`. Needed behind forward-auth proxies such as Authentik or Authelia. |
| `PAPERLESS_DOWNLOAD_DIR` | no | system temp | Where downloaded files are written. |
| `PAPERLESS_MAX_PAGE_SIZE` | no | `100` | Hard ceiling on list page sizes, whatever the model asks for. |
| `PAPERLESS_TIMEOUT_MS` | no | `60000` | Request timeout. |
| `PAPERLESS_API_VERSION` | no | `10` | REST API version sent in the `Accept` header. |

CLI flags `--url`, `--token`, `--public-url`, `--toolsets` and `--read-only` override the
environment. `--check` verifies connectivity, `--list-tools` prints the enabled tools.

## Toolsets

| Toolset | Default | Contents |
|---|---|---|
| `documents` | on | Search, read, update, delete, upload, download, notes, bulk and PDF operations |
| `metadata` | on | Tags, correspondents, document types, storage paths |
| `customfields` | on | Custom field definitions |
| `views` | on | Saved views |
| `sharing` | on | Share links and share link bundles |
| `workflows` | on | Automation rules, triggers, actions |
| `system` | on | Global search, statistics, status, tasks, trash |
| `mail` | **off** | IMAP accounts, mail rules, processed mail |
| `admin` | **off** | Users, groups, profile, configuration, logs (read-only) |

`mail` and `admin` are off by default because most sessions never need them and every extra tool
costs context on every request. Enable them explicitly:

```bash
PAPERLESS_TOOLSETS=documents,metadata,system,mail
PAPERLESS_TOOLSETS=all
```

## Context cost

Wrapping an API for a language model has a cost the API itself does not: everything the model sees
is paid for on every request. Two places where that bites, and what this server does about them.

**Responses.** Three shapes are expensive in Paperless and easy to return by accident:

| Source | Problem | Handling |
|---|---|---|
| Document lists | Every document carries its full OCR text in `content` | `?fields=` restricts the response server-side; `get_document_content` paginates the text separately |
| `/api/search/` | Returns hydrated `Document` objects, OCR text included, across all object types | Documents are summarised, other types reduced to id + name |
| Workflows, mail rules, groups, tasks | 27–34 fields per object, nested trigger/action definitions inline | Summarised to identifying fields; nested lists collapse to counts. `full: true` returns everything |

**Tool definitions.** These are the larger and less obvious cost: names, descriptions and JSON
schemas ship with *every* request, whether or not any tool is called.

| Toolsets | Tools | Approximate cost per request |
|---|---|---|
| `all` | 99 | ~20,500 tokens |
| default | 85 | ~18,500 tokens |
| `documents,metadata` | 49 | ~12,900 tokens |

There is no way to make that free — it is the price of a tool the model can use without guessing.
But it is worth being deliberate: if your sessions only ever search and file documents, running
`PAPERLESS_TOOLSETS=documents,metadata` saves more context than any response-trimming does.

## Safety

The server exposes destructive operations, because a document manager without them is not much of a
manager. It does not try to guess when they are appropriate — that judgment belongs to the client
and the user. What it does instead:

- Destructive tools are annotated `destructiveHint: true`, so MCP clients can require confirmation.
- Tool descriptions state plainly what cannot be undone (`empty_trash`, `delete_custom_field`,
  `delete_originals`) and ask for confirmation before the call.
- `--read-only` removes every write tool from the list, rather than refusing them at call time.
- Bulk endpoints support an "apply to everything matching this filter" mode. This server does
  **not** expose it: bulk tools take explicit ID lists, so a wrong filter cannot silently affect the
  entire archive.
- `create_share_link` produces a publicly reachable URL. Its description says so, and the
  `audit_sharing` prompt exists to review what is already exposed.

Credential-adjacent endpoints (token generation, TOTP enrolment, disabling someone's second factor)
are deliberately not exposed. See `EXCLUDED_ENDPOINTS` for the full list and the reasoning.

## Prompts

Registered as slash commands in clients that support MCP prompts:

| Prompt | What it does |
|---|---|
| `triage_inbox` | Walks untriaged documents, proposes metadata preferring existing entries, applies nothing until the user approves. |
| `find_document` | Locates a document from a vague description, searching cheaply before searching broadly. |
| `audit_sharing` | Reviews every public share link and flags the ones that never expire. |

## Testing

Three layers, because they catch different things:

```bash
npm test                                        # logic — no network
PAPERLESS_URL=… PAPERLESS_TOKEN=… \
  node scripts/smoke-test.mjs                   # all 55 read-only tools, live
PAPERLESS_URL=… PAPERLESS_TOKEN=… \
  node scripts/write-test.mjs                   # writes, live — see the warning
```

`npm test` checks this server's own reasoning: endpoint coverage, enum values
against the schema, that no list tool leaks raw API objects, that read-only mode
really removes writes.

`smoke-test.mjs` checks the assumptions it makes about Paperless. It calls every
read-only tool against a real instance, resolving IDs from list calls instead of
hard-coding them, and prints response sizes so expensive tools stay visible. It
writes nothing.

`write-test.mjs` covers the rest: upload and consumption, updating every field
type, notes, bulk tag edits, share links, rotation, and a trash round trip.

> **It only touches objects it creates itself.** Everything it makes is named
> with a `zz-mcp-test` prefix and deleted again at the end, and it never modifies
> a document it did not upload. If a run is interrupted, leftovers with that
> prefix are safe to delete. Prefer a test instance if you have one.

## Keeping up with Paperless

```bash
PAPERLESS_URL=… PAPERLESS_TOKEN=… node scripts/sync-schema.mjs
npm test
```

`sync-schema.mjs` regenerates `schema/endpoints.json` from your own instance's OpenAPI document.
The test suite then reports any endpoint that is neither exposed nor explicitly excluded. That is
the whole maintenance loop: point it at a newer Paperless and the test tells you what changed.

## Development

```bash
npm install
npm start          # run from source
npm run build      # compile to build/
npm test           # unit tests + coverage checks
npm run inspect    # build, then open the MCP inspector
```

## Prior art

Several MCP servers for Paperless-ngx exist, and the two most active both work against 3.x:
[cubinet-code/paperless-ngx-mcp](https://github.com/cubinet-code/paperless-ngx-mcp) adapts
between 2.x and 3.x automatically, and [baruchiro/paperless-mcp](https://github.com/baruchiro/paperless-mcp)
lets you choose the API version (`PAPERLESS_API_VERSION`, default `9`). If you need to support
both majors from one install, use one of those.

This server takes the opposite trade: it assumes API version 10 and nothing older. That is what
lets it reach the endpoints 3.x introduced — nested tags, document versions, `share_link_bundles`,
the standalone PDF operations — and lets a test assert that all 92 documented endpoints are
accounted for. It also trims list responses server-side via `?fields=`, so OCR text does not ride
along by default.

## License

MIT. See [LICENSE](LICENSE).

---

<p align="center">
  <sub>Built by <a href="https://eichner.cloud">eichner.cloud</a> — self-hosted, and rather attached to it.</sub>
</p>
