import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDocument,
  deleteDocument,
  getDocument,
  getStorageStats,
  IdempotencyConflictError,
  IdempotencyGoneError,
  listDocuments,
  sweepExpired,
  updateDocumentExpiry
} from "../src/lib/store";

describe.sequential("filesystem document store", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "md-share-test-"));
    process.env.MD_SHARE_DATA_DIR = directory;
    delete process.env.MD_SHARE_DEFAULT_TTL_DAYS;
  });

  afterEach(async () => {
    delete process.env.MD_SHARE_DATA_DIR;
    delete process.env.MD_SHARE_DEFAULT_TTL_DAYS;
    await fs.rm(directory, { recursive: true, force: true });
  });

  it("publishes body and metadata as one readable document", async () => {
    const created = await createDocument({
      markdown: "# 보고서\n",
      originalFilename: "report.md",
      ttlDays: 7
    });

    expect(created.manageToken).toBeTruthy();
    expect(created.replayed).toBe(false);
    await expect(getDocument(created.meta.id)).resolves.toEqual({
      meta: created.meta,
      markdown: "# 보고서\n"
    });
    expect(created.meta.originalFilename).toBe("report.md");
  });

  it("removes a body when metadata publication fails", async () => {
    await expect(
      createDocument(
        { markdown: "# fail" },
        undefined,
        {
          afterBodyPublished: () => {
            throw new Error("injected failure");
          }
        }
      )
    ).rejects.toThrow("injected failure");

    expect((await fs.readdir(directory)).filter((entry) => /\.(md|json)$/.test(entry))).toEqual(
      []
    );
  });

  it("deduplicates concurrent retries and rejects key reuse", async () => {
    const input = { markdown: "# once", title: "Once", ttlDays: 7 };
    const results = await Promise.all(
      Array.from({ length: 8 }, () => createDocument(input, "stable-request-key"))
    );

    expect(new Set(results.map((result) => result.meta.id)).size).toBe(1);
    expect(results.filter((result) => !result.replayed)).toHaveLength(1);
    expect(results.filter((result) => result.manageToken)).toHaveLength(1);
    await expect(
      createDocument({ ...input, markdown: "# changed" }, "stable-request-key")
    ).rejects.toBeInstanceOf(IdempotencyConflictError);
  });

  it("keeps a completed idempotency key closed after deletion", async () => {
    const created = await createDocument({ markdown: "# temporary" }, "delete-key");
    expect((await deleteDocument(created.meta.id, created.manageToken ?? "")).status).toBe("ok");

    await expect(createDocument({ markdown: "# temporary" }, "delete-key")).rejects.toBeInstanceOf(
      IdempotencyGoneError
    );
  });

  it("requires the management token for expiry changes and deletion", async () => {
    const created = await createDocument({ markdown: "# managed" });

    expect((await updateDocumentExpiry(created.meta.id, "wrong", 1)).status).toBe("forbidden");
    const updated = await updateDocumentExpiry(created.meta.id, created.manageToken ?? "", 1);
    expect(updated.status).toBe("ok");
    if (updated.status === "ok") expect(updated.value.expiresAt).not.toBeNull();
    expect((await deleteDocument(created.meta.id, "wrong")).status).toBe("forbidden");
    expect((await deleteDocument(created.meta.id, created.manageToken ?? "")).status).toBe("ok");
    await expect(getDocument(created.meta.id)).resolves.toBeNull();
  });

  it("sweeps expired documents and stale orphan files", async () => {
    const created = await createDocument({ markdown: "# expires", ttlDays: 1 / 86_400_000 });
    const orphan = path.join(directory, "Abcdef12.md");
    await fs.writeFile(orphan, "orphan", "utf8");
    const old = new Date(Date.now() - 10 * 60 * 1000);
    await fs.utimes(orphan, old, old);
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(await sweepExpired()).toBe(1);
    await expect(getDocument(created.meta.id)).resolves.toBeNull();
    await expect(fs.access(orphan)).rejects.toBeTruthy();
  });

  it("lists safe metadata and storage totals without management tokens", async () => {
    await createDocument({ markdown: "# one" });
    await createDocument({ markdown: "# two", ttlDays: 7 });

    const documents = await listDocuments();
    expect(documents).toHaveLength(2);
    expect(documents.some((document) => "manageTokenHash" in document)).toBe(false);
    await expect(getStorageStats()).resolves.toMatchObject({
      documents: 2,
      expiringDocuments: 1
    });
  });
});
