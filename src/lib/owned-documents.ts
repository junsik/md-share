export const OWNED_DOCUMENTS_STORAGE_KEY = "md-share.owned-documents.v1";
export const MAX_OWNED_DOCUMENTS = 100;

const ID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/;

export interface DocumentMetadata {
  id: string;
  title: string;
  originalFilename?: string;
  createdAt: string;
  expiresAt: string | null;
  size: number;
  url: string;
  rawUrl: string;
}

export interface OwnedDocument extends DocumentMetadata {
  manageToken: string;
  savedAt: string;
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class OwnedDocumentStorageError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "OwnedDocumentStorageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseDocumentMetadata(value: unknown): DocumentMetadata | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== "string" || !ID_PATTERN.test(value.id)) return null;
  if (typeof value.title !== "string" || !value.title.trim() || value.title.length > 200) {
    return null;
  }
  if (
    value.originalFilename !== undefined &&
    value.originalFilename !== null &&
    (typeof value.originalFilename !== "string" || value.originalFilename.length > 255)
  ) {
    return null;
  }
  if (!isIsoDate(value.createdAt)) return null;
  if (value.expiresAt !== null && !isIsoDate(value.expiresAt)) return null;
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) {
    return null;
  }
  if (!isHttpUrl(value.url) || !isHttpUrl(value.rawUrl)) return null;

  return {
    id: value.id,
    title: value.title.trim(),
    ...(typeof value.originalFilename === "string" && value.originalFilename
      ? { originalFilename: value.originalFilename }
      : {}),
    createdAt: value.createdAt,
    expiresAt: value.expiresAt,
    size: value.size,
    url: value.url,
    rawUrl: value.rawUrl
  };
}

function parseOwnedDocument(value: unknown): OwnedDocument | null {
  if (!isRecord(value)) return null;
  const metadata = parseDocumentMetadata(value);
  if (!metadata) return null;
  if (
    typeof value.manageToken !== "string" ||
    value.manageToken.length < 16 ||
    value.manageToken.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(value.manageToken)
  ) {
    return null;
  }
  if (!isIsoDate(value.savedAt)) return null;
  return { ...metadata, manageToken: value.manageToken, savedAt: value.savedAt };
}

function normalizeOwnedDocuments(value: unknown): OwnedDocument[] {
  if (!Array.isArray(value)) return [];
  const unique = new Map<string, OwnedDocument>();
  for (const item of value) {
    const document = parseOwnedDocument(item);
    if (!document || unique.has(document.id)) continue;
    unique.set(document.id, document);
  }
  return [...unique.values()]
    .sort((left, right) => right.savedAt.localeCompare(left.savedAt))
    .slice(0, MAX_OWNED_DOCUMENTS);
}

export function loadOwnedDocuments(storage: StorageLike): OwnedDocument[] {
  let raw: string | null;
  try {
    raw = storage.getItem(OWNED_DOCUMENTS_STORAGE_KEY);
  } catch (cause) {
    throw new OwnedDocumentStorageError("Browser storage is not available.", { cause });
  }
  if (!raw) return [];
  try {
    return normalizeOwnedDocuments(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function replaceOwnedDocuments(
  storage: StorageLike,
  documents: OwnedDocument[]
): OwnedDocument[] {
  const normalized = normalizeOwnedDocuments(documents);
  try {
    if (normalized.length === 0) {
      storage.removeItem(OWNED_DOCUMENTS_STORAGE_KEY);
    } else {
      storage.setItem(OWNED_DOCUMENTS_STORAGE_KEY, JSON.stringify(normalized));
    }
  } catch (cause) {
    throw new OwnedDocumentStorageError("Browser storage could not be updated.", { cause });
  }
  return normalized;
}

export function rememberOwnedDocument(
  storage: StorageLike,
  document: DocumentMetadata & { manageToken: string },
  savedAt = new Date().toISOString()
): OwnedDocument[] {
  const metadata = parseDocumentMetadata(document);
  const parsed = parseOwnedDocument({ ...document, savedAt });
  if (!metadata || !parsed) {
    throw new OwnedDocumentStorageError("The document ownership response is invalid.");
  }
  const current = loadOwnedDocuments(storage).filter((item) => item.id !== parsed.id);
  return replaceOwnedDocuments(storage, [parsed, ...current]);
}

export function refreshOwnedDocument(
  storage: StorageLike,
  metadata: DocumentMetadata
): OwnedDocument[] {
  const parsed = parseDocumentMetadata(metadata);
  if (!parsed) throw new OwnedDocumentStorageError("The document metadata response is invalid.");
  const current = loadOwnedDocuments(storage);
  return replaceOwnedDocuments(
    storage,
    current.map((document) =>
      document.id === parsed.id ? { ...document, ...parsed } : document
    )
  );
}

export function forgetOwnedDocument(storage: StorageLike, id: string): OwnedDocument[] {
  return replaceOwnedDocuments(
    storage,
    loadOwnedDocuments(storage).filter((document) => document.id !== id)
  );
}
