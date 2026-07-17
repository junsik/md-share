import { describe, expect, it } from "vitest";
import {
  forgetOwnedDocument,
  loadOwnedDocuments,
  MAX_OWNED_DOCUMENTS,
  OwnedDocumentStorageError,
  OWNED_DOCUMENTS_STORAGE_KEY,
  parseDocumentMetadata,
  refreshOwnedDocument,
  rememberOwnedDocument,
  type DocumentMetadata,
  type StorageLike
} from "../src/lib/owned-documents";

class MemoryStorage implements StorageLike {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

function metadata(id = "document_123"): DocumentMetadata {
  return {
    id,
    title: `Report ${id}`,
    originalFilename: "report.md",
    createdAt: "2026-07-17T00:00:00.000Z",
    expiresAt: "2026-08-16T00:00:00.000Z",
    size: 42,
    url: `https://share.example.test/d/${id}`,
    rawUrl: `https://share.example.test/api/documents/${id}/raw`
  };
}

describe("browser-owned document storage", () => {
  it("accepts the API's null representation for an absent original filename", () => {
    const parsed = parseDocumentMetadata({ ...metadata(), originalFilename: null });
    expect(parsed).toMatchObject({ id: "document_123", title: "Report document_123" });
    expect(parsed).not.toHaveProperty("originalFilename");
  });

  it("stores only metadata and the per-document management capability", () => {
    const storage = new MemoryStorage();
    const documents = rememberOwnedDocument(
      storage,
      { ...metadata(), manageToken: "management-token-123456" },
      "2026-07-17T01:00:00.000Z"
    );

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      id: "document_123",
      manageToken: "management-token-123456"
    });
    const raw = storage.getItem(OWNED_DOCUMENTS_STORAGE_KEY) ?? "";
    expect(raw).not.toContain("markdown");
    expect(raw).not.toContain("uploadToken");
  });

  it("refreshes public metadata while preserving the capability", () => {
    const storage = new MemoryStorage();
    rememberOwnedDocument(storage, {
      ...metadata(),
      manageToken: "management-token-123456"
    });

    const documents = refreshOwnedDocument(storage, {
      ...metadata(),
      title: "Updated report",
      expiresAt: null
    });

    expect(documents[0]).toMatchObject({
      title: "Updated report",
      expiresAt: null,
      manageToken: "management-token-123456"
    });
  });

  it("forgets only the local capability", () => {
    const storage = new MemoryStorage();
    rememberOwnedDocument(storage, {
      ...metadata(),
      manageToken: "management-token-123456"
    });

    expect(forgetOwnedDocument(storage, "document_123")).toEqual([]);
    expect(storage.getItem(OWNED_DOCUMENTS_STORAGE_KEY)).toBeNull();
  });

  it("ignores malformed and duplicate records and bounds local storage", () => {
    const storage = new MemoryStorage();
    const records = Array.from({ length: MAX_OWNED_DOCUMENTS + 5 }, (_, index) => ({
      ...metadata(`document_${String(index).padStart(3, "0")}`),
      manageToken: `management-token-${String(index).padStart(6, "0")}`,
      savedAt: new Date(Date.UTC(2026, 6, 17, 0, index)).toISOString()
    }));
    storage.setItem(
      OWNED_DOCUMENTS_STORAGE_KEY,
      JSON.stringify([records[0], { token: "bad" }, records[0], ...records.slice(1)])
    );

    const documents = loadOwnedDocuments(storage);
    expect(documents).toHaveLength(MAX_OWNED_DOCUMENTS);
    expect(new Set(documents.map((document) => document.id)).size).toBe(
      MAX_OWNED_DOCUMENTS
    );
    expect(documents[0].id).toBe("document_104");
  });

  it("reports unavailable browser storage without losing the server response", () => {
    const storage: StorageLike = {
      getItem() {
        throw new DOMException("denied", "SecurityError");
      },
      setItem() {},
      removeItem() {}
    };

    expect(() =>
      rememberOwnedDocument(storage, {
        ...metadata(),
        manageToken: "management-token-123456"
      })
    ).toThrow(OwnedDocumentStorageError);
  });
});
