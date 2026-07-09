---
name: md-share
description: >
  Share markdown as a rendered web link via a self-hosted md-share service. Use
  whenever markdown output — a report, an analysis, an incident summary, an
  agent-generated document — must reach chat/messenger users or anyone who cannot
  render a raw .md file: instead of attaching the file, POST it to md-share and
  send back the returned link. Covers the upload API, retention (ttlDays), and
  the authoring rules that make documents render well.
---

# md-share — share markdown as a rendered link

md-share renders uploaded markdown as a clean web page. Chat tools and messengers
that can't render `.md` attachments can open a link. Upload the document, return
the `url` to the user or channel.

## Configuration (set by whoever installs this skill)

- **Base URL**: `MD_SHARE_URL` env var, or replace inline below.
  <!-- INSTALL: replace https://md-share.example.com with your instance URL -->
- **Auth**: if the instance requires it, send `Authorization: Bearer $MD_SHARE_UPLOAD_TOKEN`.
  Instances with anonymous uploads enabled need no header.

## Upload

```bash
curl -s -X POST "$MD_SHARE_URL/api/documents" \
  -H "Content-Type: application/json; charset=utf-8" \
  --data-binary @payload.json
```

`payload.json`:

```json
{ "markdown": "# Title\n\n...", "ttlDays": 30 }
```

The `201` response contains `url` (rendered page — share this) and `rawUrl`
(original markdown, for machines). Full reference: [docs/API.md](../../docs/API.md).

Rules:

- Write the JSON to a **file** and send with `--data-binary` — inlining non-ASCII
  markdown into a shell argument corrupts it on some platforms.
- `ttlDays` is optional; omit it to use the instance default. Pick short TTLs
  (1–7) for throwaway output, longer for reports people will revisit. Content
  that must never expire belongs in a repo or wiki, not in md-share.
- Max 2 MiB. If a report is bigger, upload a summary and link the full data
  elsewhere.
- Anyone with the link can read the document. Never upload secrets, tokens, or
  raw customer identifiers.

## Message pattern (report → channel)

Send a 2–4 line summary of the key numbers/conclusions, then the link on its own
line. Don't paste the whole document into chat, and don't attach the .md file.

## Authoring rules (what renders)

- Start with a single `#` heading — it becomes the document title. Include the
  subject and time range.
- GitHub-flavored markdown only: tables, task lists, fenced code blocks with a
  language tag. Raw HTML is stripped — the one exception is `<br>`, the only way
  to break a line inside a table cell.
- Diagrams are `mermaid` fenced code blocks. Diagrams carry structure; numbers
  belong in tables next to them. Keep node labels short.
- Linear step flows must be `flowchart LR` (horizontal). Use `TD` only for
  shallow trees; split diagrams over ~10 nodes at a natural boundary.
- In mermaid, wrap any label containing special characters (`(){}[]`, `${...}`)
  in double quotes: `A["label (detail)"]`, `A -->|"uses ${var}"| B` — unquoted
  they fail to parse.
- Images work as `data:image/png;base64,...` sources, so self-contained documents
  with embedded screenshots render fully.
- Always state timezones next to timestamps.
