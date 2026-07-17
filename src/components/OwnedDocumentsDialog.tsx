"use client";

import { useCallback, useEffect, useState } from "react";
import {
  deleteManagedDocument,
  DocumentManagementError,
  getDocumentMetadata,
  updateDocumentExpiry
} from "@/lib/document-management";
import {
  forgetOwnedDocument,
  loadOwnedDocuments,
  OWNED_DOCUMENTS_STORAGE_KEY,
  OwnedDocumentStorageError,
  refreshOwnedDocument,
  replaceOwnedDocuments,
  type OwnedDocument
} from "@/lib/owned-documents";

const EXPIRY_OPTIONS = [
  { value: "1", label: "1 day" },
  { value: "7", label: "7 days" },
  { value: "30", label: "30 days" },
  { value: "forever", label: "Keep forever" }
] as const;

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KiB`;
}

function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "Kept forever";
  const remaining = Date.parse(expiresAt) - Date.now();
  if (remaining <= 0) return "Expired";
  const days = Math.max(1, Math.ceil(remaining / 86_400_000));
  return `Expires in ${days} day${days === 1 ? "" : "s"}`;
}

function managementError(error: unknown): string {
  if (error instanceof DocumentManagementError) {
    if (error.status === 401 || error.status === 403) {
      return "Management access is no longer valid. You can forget the local record.";
    }
    return error.message;
  }
  if (error instanceof OwnedDocumentStorageError) return error.message;
  return error instanceof Error ? error.message : "The management request failed.";
}

export default function OwnedDocumentsDialog({
  onClose,
  onDocumentsChange
}: {
  onClose: () => void;
  onDocumentsChange: (count: number) => void;
}) {
  const [documents, setDocuments] = useState<OwnedDocument[]>([]);
  const [refreshing, setRefreshing] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [documentErrors, setDocumentErrors] = useState<Record<string, string>>({});
  const [expirySelections, setExpirySelections] = useState<Record<string, string>>({});
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [confirmForgetId, setConfirmForgetId] = useState<string | null>(null);

  const applyDocuments = useCallback(
    (next: OwnedDocument[]) => {
      setDocuments(next);
      onDocumentsChange(next.length);
    },
    [onDocumentsChange]
  );

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setGlobalError(null);
    setNotice(null);
    let local: OwnedDocument[];
    try {
      local = loadOwnedDocuments(window.localStorage);
      applyDocuments(local);
    } catch (error) {
      setGlobalError(managementError(error));
      setRefreshing(false);
      return;
    }

    const errors: Record<string, string> = {};
    const results = await Promise.all(
      local.map(async (document) => {
        try {
          return { document, metadata: await getDocumentMetadata(document.id) };
        } catch (error) {
          errors[document.id] = managementError(error);
          return { document, metadata: undefined };
        }
      })
    );

    let missing = 0;
    const synchronized = results.flatMap(({ document, metadata }) => {
      if (metadata === null) {
        missing += 1;
        return [];
      }
      if (metadata === undefined) return [document];
      if (metadata.id !== document.id) {
        errors[document.id] = "The server returned mismatched document metadata.";
        return [document];
      }
      return [{ ...document, ...metadata }];
    });

    try {
      applyDocuments(replaceOwnedDocuments(window.localStorage, synchronized));
    } catch (error) {
      applyDocuments(synchronized);
      setGlobalError(managementError(error));
    }
    setDocumentErrors(errors);
    if (missing > 0) {
      setNotice(
        `${missing} unavailable document${missing === 1 ? " was" : "s were"} removed from this browser.`
      );
    }
    setRefreshing(false);
  }, [applyDocuments]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void refresh());
    function onStorage(event: StorageEvent) {
      if (event.key === null || event.key === OWNED_DOCUMENTS_STORAGE_KEY) {
        try {
          applyDocuments(loadOwnedDocuments(window.localStorage));
        } catch (error) {
          setGlobalError(managementError(error));
        }
      }
    }
    window.addEventListener("storage", onStorage);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("storage", onStorage);
    };
  }, [applyDocuments, refresh]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !pendingAction) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, pendingAction]);

  function setDocumentError(id: string, message?: string) {
    setDocumentErrors((current) => {
      const next = { ...current };
      if (message) next[id] = message;
      else delete next[id];
      return next;
    });
  }

  async function updateExpiry(document: OwnedDocument) {
    const action = `${document.id}:expiry`;
    const selection = expirySelections[document.id] ?? "30";
    const ttlDays = selection === "forever" ? null : Number(selection);
    setPendingAction(action);
    setDocumentError(document.id);
    setNotice(null);
    try {
      const metadata = await updateDocumentExpiry(
        document.id,
        document.manageToken,
        ttlDays
      );
      if (metadata.id !== document.id) {
        throw new DocumentManagementError(
          "The server returned mismatched document metadata.",
          502,
          "INVALID_RESPONSE"
        );
      }
      const next = refreshOwnedDocument(window.localStorage, metadata);
      applyDocuments(next);
      setNotice(`Expiry updated for “${metadata.title}”.`);
    } catch (error) {
      setDocumentError(document.id, managementError(error));
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteDocument(document: OwnedDocument) {
    const action = `${document.id}:delete`;
    setPendingAction(action);
    setDocumentError(document.id);
    setNotice(null);
    try {
      await deleteManagedDocument(document.id, document.manageToken);
      const next = forgetOwnedDocument(window.localStorage, document.id);
      applyDocuments(next);
      setNotice(`“${document.title}” was permanently deleted.`);
      setConfirmDeleteId(null);
    } catch (error) {
      setDocumentError(document.id, managementError(error));
    } finally {
      setPendingAction(null);
    }
  }

  function forgetDocument(document: OwnedDocument) {
    setDocumentError(document.id);
    setNotice(null);
    try {
      const next = forgetOwnedDocument(window.localStorage, document.id);
      applyDocuments(next);
      setNotice(`Local management access for “${document.title}” was removed.`);
      setConfirmForgetId(null);
    } catch (error) {
      setDocumentError(document.id, managementError(error));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-3 sm:p-6"
      onClick={() => {
        if (!pendingAction) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="owned-documents-title"
        className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 sm:px-6">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="owned-documents-title" className="text-xl font-semibold text-foreground">
                My documents
              </h2>
              <span className="rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
                {documents.length}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-5 text-muted-foreground">
              This list and its management access stay only in this browser profile. Share links
              never contain management tokens.
            </p>
          </div>
          <button
            type="button"
            aria-label="Close My documents"
            onClick={onClose}
            disabled={Boolean(pendingAction)}
            className="rounded-lg border border-border px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Close
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-border bg-background/40 px-5 py-3 sm:px-6">
          <p className="text-xs text-muted-foreground">
            Clearing browser data or using another profile removes this local access.
          </p>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={refreshing || Boolean(pendingAction)}
            className="shrink-0 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-medium text-foreground hover:border-muted-foreground disabled:opacity-50"
          >
            {refreshing ? "Refreshing…" : "Refresh"}
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
          {notice ? (
            <p role="status" className="mb-4 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              {notice}
            </p>
          ) : null}
          {globalError ? (
            <p role="alert" className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
              {globalError}
            </p>
          ) : null}

          {!refreshing && documents.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">
              <p className="font-medium text-foreground">No documents saved in this browser</p>
              <p className="mt-2 text-sm text-muted-foreground">
                Create a share link here to keep its management access locally.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map((document) => {
                const expiryAction = pendingAction === `${document.id}:expiry`;
                const deleteAction = pendingAction === `${document.id}:delete`;
                const disabled = Boolean(pendingAction);
                return (
                  <article key={document.id} className="rounded-xl border border-border bg-background/60 p-4 sm:p-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold text-foreground">{document.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {document.originalFilename ?? "Markdown document"} · {formatBytes(document.size)} · {expiryLabel(document.expiresAt)}
                        </p>
                      </div>
                      <a
                        href={document.url}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 rounded-lg border border-border bg-muted px-3 py-1.5 text-center text-sm text-foreground hover:border-muted-foreground"
                      >
                        Open
                      </a>
                    </div>

                    <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="shrink-0 text-xs font-medium text-muted-foreground">
                          Set expiry
                        </span>
                        <select
                          aria-label={`Expiry for ${document.title}`}
                          value={expirySelections[document.id] ?? "30"}
                          onChange={(event) =>
                            setExpirySelections((current) => ({
                              ...current,
                              [document.id]: event.target.value
                            }))
                          }
                          disabled={disabled}
                          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground outline-none focus:border-primary disabled:opacity-50"
                        >
                          {EXPIRY_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        onClick={() => void updateExpiry(document)}
                        disabled={disabled}
                        className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {expiryAction ? "Updating…" : "Update expiry"}
                      </button>
                    </div>

                    {documentErrors[document.id] ? (
                      <p role="alert" className="mt-3 text-sm text-red-300">
                        {documentErrors[document.id]}
                      </p>
                    ) : null}

                    <div className="mt-4 border-t border-border pt-3">
                      {confirmDeleteId === document.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
                          <p className="text-sm text-red-200">Delete this document for every viewer?</p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              disabled={disabled}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground disabled:opacity-50"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => void deleteDocument(document)}
                              disabled={disabled}
                              className="rounded-lg bg-red-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                            >
                              {deleteAction ? "Deleting…" : "Delete permanently"}
                            </button>
                          </div>
                        </div>
                      ) : confirmForgetId === document.id ? (
                        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                          <p className="text-sm text-amber-100">
                            Remove access here without deleting the shared document?
                          </p>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              onClick={() => setConfirmForgetId(null)}
                              className="rounded-lg border border-border px-3 py-1.5 text-xs text-foreground"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={() => forgetDocument(document)}
                              className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-black"
                            >
                              Forget on this browser
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmDeleteId(null);
                              setConfirmForgetId(document.id);
                            }}
                            disabled={disabled}
                            className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            Forget access
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setConfirmForgetId(null);
                              setConfirmDeleteId(document.id);
                            }}
                            disabled={disabled}
                            className="rounded-lg border border-red-500/40 px-3 py-1.5 text-xs text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                          >
                            Delete document
                          </button>
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
