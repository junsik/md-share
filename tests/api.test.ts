import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET as GET_DOCUMENT, PATCH } from "../src/app/api/documents/[id]/route";
import { POST } from "../src/app/api/documents/route";
import { MAX_MARKDOWN_BYTES } from "../src/lib/store";

describe.sequential("document API contract", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "md-share-api-test-"));
    process.env.MD_SHARE_DATA_DIR = directory;
    process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS = "true";
    process.env.MD_SHARE_PUBLIC_BASE_URL = "https://share.example.test";
  });

  afterEach(async () => {
    delete process.env.MD_SHARE_DATA_DIR;
    delete process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS;
    delete process.env.MD_SHARE_PUBLIC_BASE_URL;
    await fs.rm(directory, { recursive: true, force: true });
  });

  function jsonRequest(body: object, key = "request-1") {
    return new Request("http://localhost/api/documents", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify(body)
    });
  }

  it("creates and replays a document with stable response semantics", async () => {
    const first = await POST(
      jsonRequest({ markdown: "# report", filename: "report.md", ttlDays: 7 })
    );
    const firstBody = await first.json();
    expect(first.status).toBe(201);
    expect(firstBody).toMatchObject({
      originalFilename: "report.md",
      replayed: false,
      url: expect.stringContaining("/d/")
    });
    expect(firstBody.manageToken).toBeTruthy();

    const replay = await POST(
      jsonRequest({ markdown: "# report", filename: "report.md", ttlDays: 7 })
    );
    const replayBody = await replay.json();
    expect(replay.status).toBe(200);
    expect(replayBody.id).toBe(firstBody.id);
    expect(replayBody.replayed).toBe(true);
    expect(replayBody.manageToken).toBeUndefined();
  });

  it.each([
    [{ markdown: "# report", filename: "report.pdf" }, "UNSUPPORTED_FILE_TYPE"],
    [{ markdown: "# report\u0000binary", filename: "report.md" }, "BINARY_MARKDOWN"],
    [{ markdown: "# report", filename: "../report.md" }, "INVALID_FILENAME"]
  ])("rejects unsafe input", async (body, code) => {
    const response = await POST(jsonRequest(body, crypto.randomUUID()));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code } });
  });

  it("rejects invalid UTF-8 and oversized Markdown", async () => {
    const invalidUtf8 = await POST(
      new Request("http://localhost/api/documents?filename=report.md", {
        method: "POST",
        headers: { "content-type": "text/markdown" },
        body: new Uint8Array([0xff])
      })
    );
    expect(invalidUtf8.status).toBe(400);
    await expect(invalidUtf8.json()).resolves.toMatchObject({
      error: { code: "INVALID_UTF8" }
    });

    const oversized = await POST(
      new Request("http://localhost/api/documents?filename=report.md", {
        method: "POST",
        headers: { "content-type": "text/markdown" },
        body: "a".repeat(MAX_MARKDOWN_BYTES + 1)
      })
    );
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toMatchObject({
      error: { code: "DOCUMENT_TOO_LARGE" }
    });
  });

  it("returns a conflict when a key is reused for another request", async () => {
    expect((await POST(jsonRequest({ markdown: "# one" }, "same-key"))).status).toBe(201);
    const response = await POST(jsonRequest({ markdown: "# two" }, "same-key"));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "IDEMPOTENCY_CONFLICT" }
    });
  });

  it("exposes metadata and manages expiry and deletion with the one-time token", async () => {
    const createResponse = await POST(jsonRequest({ markdown: "# managed" }, "manage-key"));
    const created = await createResponse.json();
    const context = { params: Promise.resolve({ id: created.id as string }) };

    const metadata = await GET_DOCUMENT(new Request(`http://localhost/api/documents/${created.id}`), context);
    expect(metadata.status).toBe(200);
    await expect(metadata.json()).resolves.not.toHaveProperty("manageToken");

    const forbidden = await PATCH(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "PATCH",
        headers: { authorization: "Bearer wrong", "content-type": "application/json" },
        body: JSON.stringify({ ttlDays: 1 })
      }),
      context
    );
    expect(forbidden.status).toBe(403);

    const updated = await PATCH(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${created.manageToken}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({ ttlDays: null })
      }),
      context
    );
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({ expiresAt: null });

    const deleted = await DELETE(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${created.manageToken}` }
      }),
      context
    );
    expect(deleted.status).toBe(204);
    expect(
      (await GET_DOCUMENT(new Request(`http://localhost/api/documents/${created.id}`), context)).status
    ).toBe(404);
  });
});
