"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadOwnedDocuments, rememberOwnedDocument } from "@/lib/owned-documents";
import AiButton from "./AiButton";
import MarkdownView from "./MarkdownView";
import OwnedDocumentsDialog from "./OwnedDocumentsDialog";

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

const EXPIRY_OPTIONS: { label: string; ttlDays: number | null }[] = [
  { label: "1 day", ttlDays: 1 },
  { label: "7 days", ttlDays: 7 },
  { label: "30 days", ttlDays: 30 },
  { label: "Keep forever", ttlDays: null }
];

const MAX_MARKDOWN_BYTES = 2 * 1024 * 1024;

interface ShareResult {
  id: string;
  title: string;
  originalFilename?: string;
  createdAt: string;
  url: string;
  rawUrl: string;
  expiresAt: string | null;
  size: number;
  manageToken?: string;
  replayed: boolean;
}

function uploadError(value: unknown, status: number): string {
  if (typeof value === "string" && value) return value;
  if (value && typeof value === "object" && "message" in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === "string" && message) return message;
  }
  return `Upload failed (HTTP ${status})`;
}

function ShareDialog({
  markdown,
  filename,
  anonymousUploads,
  onClose,
  onOwnedDocumentSaved,
  onOpenOwnedDocuments
}: {
  markdown: string;
  filename?: string;
  anonymousUploads: boolean;
  onClose: () => void;
  onOwnedDocumentSaved: () => void;
  onOpenOwnedDocuments: () => void;
}) {
  const [title, setTitle] = useState("");
  const [token, setToken] = useState("");
  const [expiryIndex, setExpiryIndex] = useState(2);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ShareResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);
  const [ownershipState, setOwnershipState] = useState<
    "saved" | "replayed" | "storage-failed" | null
  >(null);
  const idempotencyKey = useRef(crypto.randomUUID());

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      const headers: Record<string, string> = {
        "content-type": "application/json",
        "idempotency-key": idempotencyKey.current
      };
      if (token.trim()) headers.authorization = `Bearer ${token.trim()}`;
      const response = await fetch("/api/documents", {
        method: "POST",
        headers,
        body: JSON.stringify({
          markdown,
          title: title.trim() || undefined,
          filename,
          ttlDays: EXPIRY_OPTIONS[expiryIndex].ttlDays
        })
      });
      const body = (await response.json()) as ShareResult & {
        error?: string | { code?: string; message?: string };
      };
      if (!response.ok) {
        setError(uploadError(body.error, response.status));
        return;
      }
      setResult(body);
      if (body.manageToken) {
        try {
          rememberOwnedDocument(window.localStorage, {
            id: body.id,
            title: body.title,
            ...(body.originalFilename
              ? { originalFilename: body.originalFilename }
              : {}),
            createdAt: body.createdAt,
            expiresAt: body.expiresAt,
            size: body.size,
            url: body.url,
            rawUrl: body.rawUrl,
            manageToken: body.manageToken
          });
          setOwnershipState("saved");
          onOwnedDocumentSaved();
        } catch {
          setOwnershipState("storage-failed");
        }
      } else {
        setOwnershipState("replayed");
      }
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

  async function copyRecoveryToken(token: string) {
    try {
      await navigator.clipboard.writeText(token);
      setRecoveryCopied(true);
    } catch {
      setRecoveryCopied(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-document-title"
        className="w-full max-w-md rounded-xl border border-border bg-card p-6 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="share-document-title" className="text-lg font-semibold text-foreground">
          Share document
        </h2>
        {result ? (
          <div className="mt-4 space-y-3 text-sm">
            <p className="font-medium text-foreground">{result.title}</p>
            <a href={result.url} className="block break-all text-primary underline">
              {result.url}
            </a>
            {ownershipState === "saved" ? (
              <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-3">
                <p className="text-emerald-200">
                  Management access is saved only in this browser. It is not part of the
                  shared link.
                </p>
              </div>
            ) : ownershipState === "storage-failed" && result.manageToken ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-amber-100">
                  This browser could not save management access. Copy the one-time recovery
                  token before closing.
                </p>
                <code className="mt-2 block select-all break-all rounded bg-black/30 p-2 text-xs text-foreground">
                  {result.manageToken}
                </code>
                <button
                  type="button"
                  onClick={() => copyRecoveryToken(result.manageToken ?? "")}
                  className="mt-2 rounded border border-amber-400/50 px-3 py-1.5 text-xs font-medium text-amber-100"
                >
                  {recoveryCopied ? "Recovery token copied" : "Copy recovery token"}
                </button>
              </div>
            ) : ownershipState === "replayed" ? (
              <div className="rounded border border-amber-500/40 bg-amber-500/10 p-3">
                <p className="text-amber-100">
                  The share link was recovered from a safe retry, but its one-time management
                  token is no longer available.
                </p>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyLink(result.url)}
                className="rounded bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground"
              >
                {copied ? "Copied" : "Copy link"}
              </button>
              {ownershipState === "saved" ? (
                <button
                  type="button"
                  onClick={onOpenOwnedDocuments}
                  className="rounded border border-primary/50 px-3 py-1.5 text-sm text-primary hover:bg-primary/10"
                >
                  Open My documents
                </button>
              ) : null}
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
            {anonymousUploads ? (
              <p className="rounded border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-emerald-200">
                Anonymous sharing is enabled. No upload token is required.
              </p>
            ) : (
              <label className="block">
                <span className="mb-1 block text-muted-foreground">Upload token</span>
                <input
                  type="password"
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  placeholder="MD_SHARE_UPLOAD_TOKEN"
                  className="w-full rounded border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </label>
            )}
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

export default function Editor({ anonymousUploads }: { anonymousUploads: boolean }) {
  const [markdown, setMarkdown] = useState("");
  const [preview, setPreview] = useState("");
  const [filename, setFilename] = useState<string | undefined>();
  const [fileError, setFileError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [ownedDialogOpen, setOwnedDialogOpen] = useState(false);
  const [ownedDocumentCount, setOwnedDocumentCount] = useState(0);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Which pane the user is actively scrolling; blocks echo events from the
  // programmatic scroll on the other pane.
  const scrollSource = useRef<"editor" | "preview" | null>(null);

  const refreshOwnedDocumentCount = useCallback(() => {
    try {
      setOwnedDocumentCount(loadOwnedDocuments(window.localStorage).length);
    } catch {
      setOwnedDocumentCount(0);
    }
  }, []);

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
    const frame = window.requestAnimationFrame(() => {
      const draft = window.localStorage.getItem(DRAFT_KEY);
      const initial = draft ?? DEFAULT_DOCUMENT;
      setMarkdown(initial);
      setPreview(initial);
      setLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(refreshOwnedDocumentCount);
    function onStorage() {
      refreshOwnedDocumentCount();
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("storage", onStorage);
    };
  }, [refreshOwnedDocumentCount]);

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

  async function openMarkdownFile(file: File) {
    setFileError(null);
    if (!file.name.toLowerCase().endsWith(".md")) {
      setFileError("Only .md files are supported.");
      return;
    }
    if (file.size > MAX_MARKDOWN_BYTES) {
      setFileError(`The file exceeds ${MAX_MARKDOWN_BYTES} bytes.`);
      return;
    }
    try {
      const content = await file.text();
      if (!content.trim() || content.includes("\u0000")) {
        setFileError("The file must contain non-empty UTF-8 Markdown text.");
        return;
      }
      setMarkdown(content);
      setPreview(content);
      setFilename(file.name);
    } catch {
      setFileError("The Markdown file could not be read.");
    }
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) void openMarkdownFile(file);
  }

  return (
    <div
      className="flex h-screen flex-col"
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="flex flex-col gap-3 border-b border-border bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <h1 className="text-lg font-semibold tracking-wide text-foreground">
          md-share
        </h1>
        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,text/markdown"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.item(0);
              if (file) void openMarkdownFile(file);
              event.currentTarget.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="rounded border border-border bg-muted px-4 py-1.5 text-sm text-foreground hover:border-muted-foreground"
          >
            Open .md
          </button>
          <AiButton />
          <button
            type="button"
            onClick={() => setOwnedDialogOpen(true)}
            className="rounded border border-border bg-muted px-4 py-1.5 text-sm text-foreground hover:border-muted-foreground"
          >
            My documents
            {ownedDocumentCount > 0 ? (
              <span className="ml-1.5 rounded-full bg-primary/20 px-1.5 py-0.5 text-xs text-primary">
                {ownedDocumentCount}
              </span>
            ) : null}
          </button>
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
      {fileError ? (
        <p className="border-b border-red-500/30 bg-red-500/10 px-6 py-2 text-sm text-red-300">
          {fileError}
        </p>
      ) : filename ? (
        <p className="border-b border-border bg-muted px-6 py-2 text-xs text-muted-foreground">
          Loaded {filename}
        </p>
      ) : null}
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
        <ShareDialog
          markdown={markdown}
          filename={filename}
          anonymousUploads={anonymousUploads}
          onClose={() => setDialogOpen(false)}
          onOwnedDocumentSaved={refreshOwnedDocumentCount}
          onOpenOwnedDocuments={() => {
            setDialogOpen(false);
            setOwnedDialogOpen(true);
          }}
        />
      ) : null}
      {ownedDialogOpen ? (
        <OwnedDocumentsDialog
          onClose={() => setOwnedDialogOpen(false)}
          onDocumentsChange={setOwnedDocumentCount}
        />
      ) : null}
    </div>
  );
}
