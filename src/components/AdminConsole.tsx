"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface AdminSession {
  username: string;
  expiresAt: string;
  csrfToken: string;
}

interface StorageStats {
  documents: number;
  bytes: number;
  expiringDocuments: number;
}

interface AdminDocument {
  id: string;
  title: string;
  originalFilename: string | null;
  createdAt: string;
  expiresAt: string | null;
  size: number;
  url: string;
  rawUrl: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(bytes < 10_240 ? 1 : 0)} KiB`;
  return `${(bytes / 1_048_576).toFixed(1)} MiB`;
}

function createdLabel(createdAt: string): string {
  const age = Date.now() - Date.parse(createdAt);
  if (age >= 0 && age < 60 * 60 * 1_000) return "Created recently";
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(createdAt));
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Kept forever";
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) return "Expired";
  const days = Math.max(1, Math.ceil(remaining / 86_400_000));
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const value = await response.json().catch(() => undefined);
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return fallback;
}

export default function AdminConsole() {
  const router = useRouter();
  const [session, setSession] = useState<AdminSession | null>(null);
  const [storage, setStorage] = useState<StorageStats | null>(null);
  const [documents, setDocuments] = useState<AdminDocument[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sessionResponse, statusResponse, documentsResponse] = await Promise.all([
        fetch("/api/admin/session", { cache: "no-store" }),
        fetch("/api/status", { cache: "no-store" }),
        fetch("/api/documents", { cache: "no-store" })
      ]);
      if (sessionResponse.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!sessionResponse.ok || !statusResponse.ok || !documentsResponse.ok) {
        throw new Error("Administrator data could not be loaded.");
      }
      const sessionBody = (await sessionResponse.json()) as AdminSession;
      const statusBody = (await statusResponse.json()) as { storage: StorageStats };
      const documentsBody = (await documentsResponse.json()) as { documents: AdminDocument[] };
      setSession(sessionBody);
      setStorage(statusBody.storage);
      setDocuments(documentsBody.documents);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Administrator data could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [load]);

  const visibleDocuments = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return documents;
    return documents.filter((document) =>
      [document.title, document.originalFilename ?? "", document.id].some((value) =>
        value.toLocaleLowerCase().includes(normalized)
      )
    );
  }, [documents, query]);

  async function deleteDocument(document: AdminDocument) {
    if (!session) return;
    setPendingDelete(document.id);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/documents/${document.id}`, {
        method: "DELETE",
        headers: { "x-md-share-csrf": session.csrfToken }
      });
      if (response.status === 401) {
        router.replace("/admin/login");
        return;
      }
      if (!response.ok) throw new Error(await errorMessage(response, "Document could not be deleted."));
      setDocuments((current) => current.filter((item) => item.id !== document.id));
      setStorage((current) =>
        current
          ? {
              documents: Math.max(0, current.documents - 1),
              bytes: Math.max(0, current.bytes - document.size),
              expiringDocuments: Math.max(
                0,
                current.expiringDocuments - (document.expiresAt ? 1 : 0)
              )
            }
          : current
      );
      setNotice(`“${document.title}” was permanently deleted.`);
      setConfirmDelete(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Document could not be deleted.");
    } finally {
      setPendingDelete(null);
    }
  }

  async function logout() {
    if (!session) return;
    setError(null);
    try {
      const response = await fetch("/api/admin/session", {
        method: "DELETE",
        headers: { "x-md-share-csrf": session.csrfToken }
      });
      if (!response.ok && response.status !== 401) {
        throw new Error(await errorMessage(response, "Sign out failed."));
      }
      router.replace("/admin/login");
      router.refresh();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : "Sign out failed.");
    }
  }

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
              md-share
            </Link>
            <h1 className="mt-1 text-2xl font-semibold text-foreground">Operations console</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Metadata-only document administration. Markdown content is not shown here.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {session ? (
              <span className="rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
                Signed in as <strong className="text-foreground">{session.username}</strong>
              </span>
            ) : null}
            <button
              type="button"
              onClick={() => void logout()}
              disabled={!session}
              className="rounded-lg border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Sign out
            </button>
          </div>
        </header>

        {error ? (
          <p role="alert" className="mt-5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p role="status" className="mt-5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {notice}
          </p>
        ) : null}

        <section aria-label="Storage summary" className="mt-6 grid gap-3 sm:grid-cols-3">
          {[
            ["Active documents", storage?.documents ?? "—"],
            ["Stored markdown", storage ? formatBytes(storage.bytes) : "—"],
            ["Expiring documents", storage?.expiringDocuments ?? "—"]
          ].map(([label, value]) => (
            <article key={label} className="rounded-xl border border-border bg-card p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
            </article>
          ))}
        </section>

        <section className="mt-6 overflow-hidden rounded-xl border border-border bg-card">
          <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold text-foreground">Recent documents</h2>
              <p className="mt-1 text-xs text-muted-foreground">Up to 50 active documents, newest first.</p>
            </div>
            <div className="flex gap-2">
              <input
                type="search"
                aria-label="Search documents"
                placeholder="Search title, filename, or ID"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="min-w-0 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-primary sm:w-72"
              />
              <button
                type="button"
                onClick={() => void load()}
                disabled={loading}
                className="rounded-lg border border-border px-3 py-2 text-sm text-foreground disabled:opacity-50"
              >
                {loading ? "Loading…" : "Refresh"}
              </button>
            </div>
          </div>

          {!loading && visibleDocuments.length === 0 ? (
            <div className="px-6 py-16 text-center text-sm text-muted-foreground">
              {documents.length === 0 ? "No active documents." : "No documents match this search."}
            </div>
          ) : (
            <div className="divide-y divide-border">
              {visibleDocuments.map((document) => (
                <article key={document.id} className="p-4 sm:p-5">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="truncate font-medium text-foreground">{document.title}</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {document.originalFilename ?? "Markdown document"} · {formatBytes(document.size)} · {createdLabel(document.createdAt)} · {expiryLabel(document.expiresAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground"
                      >
                        Open
                      </a>
                      <a
                        href={document.rawUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground"
                      >
                        Raw
                      </a>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(document.id)}
                        disabled={Boolean(pendingDelete)}
                        className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>

                  {confirmDelete === document.id ? (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                      <p className="text-sm text-red-200">Delete this document for every viewer?</p>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(null)}
                          disabled={Boolean(pendingDelete)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          onClick={() => void deleteDocument(document)}
                          disabled={Boolean(pendingDelete)}
                          className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                        >
                          {pendingDelete === document.id ? "Deleting…" : "Delete permanently"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
