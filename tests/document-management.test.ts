import { describe, expect, it, vi } from "vitest";
import {
  deleteManagedDocument,
  DocumentManagementError,
  getDocumentMetadata,
  updateDocumentExpiry
} from "../src/lib/document-management";

const metadata = {
  id: "document_123",
  title: "Report",
  originalFilename: "report.md",
  createdAt: "2026-07-17T00:00:00.000Z",
  expiresAt: "2026-08-16T00:00:00.000Z",
  size: 42,
  url: "https://share.example.test/d/document_123",
  rawUrl: "https://share.example.test/api/documents/document_123/raw"
};

describe("document management client", () => {
  it("refreshes public metadata without sending the management token", async () => {
    const fetcher = vi.fn(async () => Response.json(metadata));

    await expect(getDocumentMetadata("document_123", fetcher)).resolves.toEqual(metadata);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/documents/document_123",
      expect.objectContaining({ headers: { accept: "application/json" } })
    );
    expect(JSON.stringify(fetcher.mock.calls[0])).not.toContain("management-token");
  });

  it("updates expiry with the document capability", async () => {
    const fetcher = vi.fn(async () => Response.json({ ...metadata, expiresAt: null }));

    await expect(
      updateDocumentExpiry("document_123", "management-token", null, fetcher)
    ).resolves.toMatchObject({ expiresAt: null });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/documents/document_123",
      expect.objectContaining({
        method: "PATCH",
        headers: expect.objectContaining({ authorization: "Bearer management-token" }),
        body: JSON.stringify({ ttlDays: null })
      })
    );
  });

  it("treats an already missing document as a completed delete", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      deleteManagedDocument("document_123", "management-token", fetcher)
    ).resolves.toBe("missing");
  });

  it("keeps stable API errors for the UI", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        { error: { code: "MANAGE_AUTH_FAILED", message: "management token is invalid" } },
        { status: 403 }
      )
    );

    const request = updateDocumentExpiry(
      "document_123",
      "wrong-management-token",
      7,
      fetcher
    );
    await expect(request).rejects.toMatchObject({
      name: "DocumentManagementError",
      status: 403,
      code: "MANAGE_AUTH_FAILED"
    } satisfies Partial<DocumentManagementError>);
  });
});
