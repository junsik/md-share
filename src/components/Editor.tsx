"use client";

import { useEffect, useRef, useState } from "react";
import AiButton from "./AiButton";
import MarkdownView from "./MarkdownView";

const DRAFT_KEY = "md-share:draft:v2";

const DEFAULT_DOCUMENT = `# md-share quick tour

Write markdown on the left — the preview updates as you type.
Press **Share** to publish this document and hand out the link.

## What renders

| Element | Supported |
| --- | --- |
| GFM tables & task lists | yes |
| Syntax-highlighted code | yes |
| Mermaid diagrams | yes |
| Raw HTML | no — stripped for safety |

## How sharing works

\`\`\`mermaid
sequenceDiagram
  participant You
  participant S as md-share
  participant Reader
  You->>S: POST /api/documents (markdown)
  S-->>You: share URL
  You->>Reader: send the link
  Reader->>S: GET /d/{id}
  S-->>Reader: rendered page
\`\`\`

## Code sample

\`\`\`python
def budget(days: int) -> str:
    return f"this document expires in {days} days"
\`\`\`

## Try it

- [x] edit this text and watch the preview
- [ ] press **Save** to download the .md file
- [ ] press **Share** and pick a retention period

> Tip: uploads from scripts or agents work too — see the README for the API.
`;

const EXPIRY_OPTIONS: { label: string; ttlDays?: number }[] = [
  { label: "1 day", ttlDays: 1 },
  { label: "7 days", ttlDays: 7 },
  { label: "30 days", ttlDays: 30 },
  { label: "Keep forever" }
];

interface ShareResult {
  id: string;
  title: string;
  url: string;
  rawUrl: string;
  expiresAt: string | null;
}

function ShareDialog({ markdown, onClose }: { markdown: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [token, setToken] = useState("");
  const [expiryIndex, setExpiryIndex] = useState(2);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
      const response = await fetch("/api/documents", {
        method: "POST",
        headers,
        body: JSON.stringify({
          markdown,
          title: title.trim() || undefined,
          ttlDays: EXPIRY_OPTIONS[expiryIndex].ttlDays
        })
      });
      const body = (await response.json()) as ShareResult & { error?: string };
      if (!response.ok) {
        setError(body.error ?? `Upload failed (HTTP ${response.status})`);
        return;
      }
      setResult(body);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload request failed.");
    } finally {
      setPending(false);
    }
  }

  async function copyLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-foreground">Share document</h2>
        {result ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="font-medium text-foreground">{result.title}</p>
            <a href={result.url} className="block break-all text-primary underline">
              {result.url}
            </a>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => copyLink(result.url)}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
              >
                Close
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Title (optional)</span>
              <input
                type="text"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Defaults to the first heading"
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Upload token</span>
              <input
                type="password"
                value={token}
                onChange={(event) => setToken(event.target.value)}
                placeholder="MD_SHARE_UPLOAD_TOKEN (optional in dev)"
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-muted-foreground">Expires</span>
              <select
                value={expiryIndex}
                onChange={(event) => setExpiryIndex(Number(event.target.value))}
                className="w-full rounded border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
              >
                {EXPIRY_OPTIONS.map((option, index) => (
                  <option key={option.label} value={index}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {error ? <p className="text-red-400">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded border border-border px-3 py-1.5 text-muted-foreground hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending || !markdown.trim()}
                className="rounded bg-primary px-4 py-1.5 font-medium text-primary-foreground disabled:opacity-50"
              >
                {pending ? "Sharing…" : "Create link"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function Editor() {
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // Which pane the user is actively scrolling; blocks echo events from the
  // programmatic scroll on the other pane.
  const scrollSource = useRef<"editor" | "preview" | null>(null);

  function syncScroll(source: "editor" | "preview") {
    if (scrollSource.current && scrollSource.current !== source) return;
    scrollSource.current = source;
    const from = source === "editor" ? editorRef.current : previewRef.current;
    const to = source === "editor" ? previewRef.current : editorRef.current;
    if (!from || !to) return;
    const fromRange = from.scrollHeight - from.clientHeight;
    const toRange = to.scrollHeight - to.clientHeight;
    if (fromRange > 0 && toRange > 0) {
      to.scrollTop = (from.scrollTop / fromRange) * toRange;
    }
    window.requestAnimationFrame(() => {
      scrollSource.current = null;
    });
  }

  useEffect(() => {
    const draft = window.localStorage.getItem(DRAFT_KEY);
    const initial = draft ?? DEFAULT_DOCUMENT;
    setMarkdown(initial);
    setPreview(initial);
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    const timer = setTimeout(() => {
      setPreview(markdown);
      window.localStorage.setItem(DRAFT_KEY, markdown);
    }, 400);
    return () => clearTimeout(timer);
  }, [markdown, loaded]);

  function download() {
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "document.md";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <h1 className="text-lg font-semibold tracking-wide text-foreground">
          md-share
        </h1>
        <div className="flex items-center gap-2">
          <AiButton />
          <button
            type="button"
            onClick={download}
            className="rounded border border-border bg-muted px-4 py-1.5 text-sm text-foreground hover:border-muted-foreground"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="rounded bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Share
          </button>
        </div>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-2">
        <textarea
          ref={editorRef}
          value={markdown}
          onChange={(event) => setMarkdown(event.target.value)}
          onScroll={() => syncScroll("editor")}
          spellCheck={false}
          placeholder="# Start writing markdown..."
          className="h-full w-full resize-none overflow-y-auto border-b border-border bg-background p-6 font-mono text-sm leading-6 text-foreground outline-none md:border-b-0 md:border-r"
        />
        <div
          ref={previewRef}
          onScroll={() => syncScroll("preview")}
          className="h-full overflow-y-auto bg-card p-8"
        >
          <MarkdownView markdown={preview} />
        </div>
      </div>
      {dialogOpen ? (
        <ShareDialog markdown={markdown} onClose={() => setDialogOpen(false)} />
      ) : null}
    </div>
  );
}
