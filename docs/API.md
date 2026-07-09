# md-share HTTP API

Everything the web UI does goes through this API — it is the intended integration
surface for scripts and AI agents. All requests and responses are UTF-8.

## Authentication

Upload/list endpoints check auth in this order:

| Mode | Server configuration | Client requirement |
| --- | --- | --- |
| Anonymous | `MD_SHARE_ALLOW_ANONYMOUS_UPLOADS=true` | none |
| Bearer token | `MD_SHARE_UPLOAD_TOKEN=<secret>` | `Authorization: Bearer <secret>` |
| Development | neither set, `NODE_ENV != production` | none |

With neither variable set in production, uploads are disabled (fail-closed, `503`).
Reading a document (`/d/{id}`, `/api/documents/{id}/raw`) never requires auth —
anyone with the link can read.

## Endpoints

### `POST /api/documents` — upload markdown

Two request styles:

**JSON** (recommended — no query-string escaping issues):

```bash
curl -X POST https://md-share.example.com/api/documents \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @payload.json
```

```json
{
  "markdown": "# Report title\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n",
  "title": "optional explicit title",
  "ttlDays": 30
}
```

**Plain text** — the raw body is the markdown; options go in the query string:

```bash
curl -X POST "https://md-share.example.com/api/documents?ttlDays=7" \
  -H "Content-Type: text/plain; charset=utf-8" \
  --data-binary @report.md
```

| Field | Type | Notes |
| --- | --- | --- |
| `markdown` | string, required | the document body; max 2 MiB (UTF-8 bytes) |
| `title` | string, optional | defaults to the first `#`–`######` heading, else `Untitled` |
| `ttlDays` | positive number, optional | defaults to `MD_SHARE_DEFAULT_TTL_DAYS`; if neither is set the document never expires |

**Response `201`:**

```json
{
  "id": "ndremUMOcwQp",
  "title": "Report title",
  "createdAt": "2026-07-09T00:12:17.390Z",
  "expiresAt": "2026-08-08T00:12:17.390Z",
  "size": 44,
  "url": "https://md-share.example.com/d/ndremUMOcwQp",
  "rawUrl": "https://md-share.example.com/api/documents/ndremUMOcwQp/raw"
}
```

Share `url` with humans (rendered page); `rawUrl` serves the original markdown
(`text/markdown`) for machines and for the
[Confluence macro](https://github.com/junsik/md-share-confluence).
`expiresAt` is `null` for permanent documents.

### `GET /api/documents` — list recent documents

Same auth as upload. Returns up to 50 non-expired documents, newest first:

```json
{ "documents": [ { "id": "...", "title": "...", "createdAt": "...", "expiresAt": null, "size": 123, "url": "...", "rawUrl": "..." } ] }
```

### `GET /api/documents/{id}/raw` — raw markdown

No auth. `200` with `Content-Type: text/markdown; charset=utf-8`, or `404 not found`
(unknown **or expired** — expired documents are deleted on first access after expiry).

### `GET /d/{id}` — rendered page

No auth. The human-facing HTML page. Not an API endpoint, but this is the link to
put in chat messages.

## Errors

| Status | Body | Cause |
| --- | --- | --- |
| `400` | `{"error": "invalid JSON body"}` | malformed JSON |
| `400` | `{"error": "markdown must be a non-empty string"}` | missing/empty `markdown` field |
| `400` | `{"error": "ttlDays must be a positive number"}` | zero/negative/non-numeric TTL |
| `401` | `{"error": "invalid upload token"}` | bad or missing Bearer token |
| `413` | `{"error": "markdown exceeds 2097152 bytes"}` | document over 2 MiB |
| `503` | `{"error": "MD_SHARE_UPLOAD_TOKEN is not configured"}` | production with no auth mode configured |

## Retention

- Expired documents are removed lazily on access and by an hourly background sweep.
- `expiresAt: null` means the document is kept until manually deleted from the data
  directory.

## What renders

- GitHub-flavored markdown: tables, task lists, strikethrough, fenced code blocks
  with syntax highlighting.
- `mermaid` fenced code blocks render as diagrams in the browser.
- Raw HTML is **not** rendered (XSS-safe default), with one exception: `<br>`
  becomes a real line break — it is the only way to break a line inside a GFM
  table cell.
- `data:image/png|jpeg|gif|webp;base64,...` image sources are allowed, so fully
  self-contained documents (embedded screenshots) work. Other `data:` URIs stay
  blocked.

## Tips for non-ASCII content

Send the markdown as a file (`--data-binary @file`) with an explicit
`charset=utf-8` content type, as in the examples above. Inlining non-ASCII text
into a shell argument corrupts it on some platforms (e.g. Windows consoles).
