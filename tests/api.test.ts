import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as POST_ADMIN_SESSION } from "../src/app/api/admin/session/route";
import { DELETE, GET as GET_DOCUMENT, PATCH } from "../src/app/api/documents/[id]/route";
import { GET as GET_DOCUMENTS, POST } from "../src/app/api/documents/route";
import { GET as GET_STATUS } from "../src/app/api/status/route";
import { resetAnonymousUploadRateLimit } from "../src/lib/anonymous-rate-limit";
import { resetAdminAuthState } from "../src/lib/admin-auth";
import { MAX_MARKDOWN_BYTES } from "../src/lib/store";

describe.sequential("document API contract", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fs.mkdtemp(path.join(os.tmpdir(), "md-share-api-test-"));
    process.env.MD_SHARE_DATA_DIR = directory;
    process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS = "true";
    process.env.MD_SHARE_PUBLIC_BASE_URL = "https://share.example.test";
    resetAnonymousUploadRateLimit();
    resetAdminAuthState();
  });

  afterEach(async () => {
    delete process.env.MD_SHARE_DATA_DIR;
    delete process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS;
    delete process.env.MD_SHARE_UPLOAD_TOKEN;
    delete process.env.MD_SHARE_ADMIN_USERNAME;
    delete process.env.MD_SHARE_ADMIN_PASSWORD;
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_LIMIT;
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT;
    delete process.env.MD_SHARE_ANONYMOUS_UPLOAD_WINDOW_SECONDS;
    delete process.env.MD_SHARE_PUBLIC_BASE_URL;
    resetAnonymousUploadRateLimit();
    resetAdminAuthState();
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

  it("protects operational APIs while document creation stays anonymous", async () => {
    process.env.MD_SHARE_UPLOAD_TOKEN = "operator-token-for-tests";
    expect((await POST(jsonRequest({ markdown: "# anonymous" }, "anonymous-key"))).status).toBe(
      201
    );

    const listDenied = await GET_DOCUMENTS(
      new Request("http://localhost/api/documents")
    );
    expect(listDenied.status).toBe(401);
    await expect(listDenied.json()).resolves.toMatchObject({
      error: { code: "OPERATOR_AUTH_FAILED" }
    });
    expect((await GET_STATUS(new Request("http://localhost/api/status"))).status).toBe(401);

    const headers = { authorization: "Bearer operator-token-for-tests" };
    expect(
      (await GET_DOCUMENTS(new Request("http://localhost/api/documents", { headers }))).status
    ).toBe(200);
    expect((await GET_STATUS(new Request("http://localhost/api/status", { headers }))).status).toBe(
      200
    );
  });

  it("rate limits anonymous callers while allowing an authenticated operator", async () => {
    process.env.MD_SHARE_UPLOAD_TOKEN = "operator-token-for-tests";
    process.env.MD_SHARE_ANONYMOUS_UPLOAD_LIMIT = "2";
    process.env.MD_SHARE_ANONYMOUS_UPLOAD_GLOBAL_LIMIT = "10";
    const request = (key: string, operator = false) =>
      new Request("http://localhost/api/documents", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
          "x-real-ip": "192.0.2.10",
          ...(operator ? { authorization: "Bearer operator-token-for-tests" } : {})
        },
        body: JSON.stringify({ markdown: `# ${key}` })
      });

    expect((await POST(request("limited-1"))).status).toBe(201);
    expect((await POST(request("limited-2"))).status).toBe(201);
    const limited = await POST(request("limited-3"));
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    await expect(limited.json()).resolves.toMatchObject({
      error: { code: "ANONYMOUS_UPLOAD_RATE_LIMITED" }
    });
    expect((await POST(request("operator-bypass", true))).status).toBe(201);
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

  it("keeps management document-scoped and lets the operator delete any document", async () => {
    process.env.MD_SHARE_UPLOAD_TOKEN = "operator-token-for-tests";
    const first = await (await POST(jsonRequest({ markdown: "# first" }, "first-key"))).json();
    const second = await (await POST(jsonRequest({ markdown: "# second" }, "second-key"))).json();
    const secondContext = { params: Promise.resolve({ id: second.id as string }) };

    const crossDocument = await DELETE(
      new Request(`http://localhost/api/documents/${second.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${first.manageToken}` }
      }),
      secondContext
    );
    expect(crossDocument.status).toBe(403);

    const operatorPatch = await PATCH(
      new Request(`http://localhost/api/documents/${second.id}`, {
        method: "PATCH",
        headers: {
          authorization: "Bearer operator-token-for-tests",
          "content-type": "application/json"
        },
        body: JSON.stringify({ ttlDays: null })
      }),
      secondContext
    );
    expect(operatorPatch.status).toBe(403);

    const operatorDelete = await DELETE(
      new Request(`http://localhost/api/documents/${second.id}`, {
        method: "DELETE",
        headers: { authorization: "Bearer operator-token-for-tests" }
      }),
      secondContext
    );
    expect(operatorDelete.status).toBe(204);
  });

  it("uses the administrator session for operational reads and CSRF-protected deletion only", async () => {
    process.env.MD_SHARE_ADMIN_USERNAME = "operations";
    process.env.MD_SHARE_ADMIN_PASSWORD = "installer-chosen-password";
    const created = await (
      await POST(jsonRequest({ markdown: "# administrator managed" }, "admin-managed-key"))
    ).json();
    const context = { params: Promise.resolve({ id: created.id as string }) };

    const login = await POST_ADMIN_SESSION(
      new Request("http://localhost/api/admin/session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          username: "operations",
          password: "installer-chosen-password"
        })
      })
    );
    const loginBody = await login.json();
    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];
    expect(cookie).toContain("md_share_admin_session=");

    expect(
      (
        await GET_DOCUMENTS(
          new Request("http://localhost/api/documents", { headers: { cookie } })
        )
      ).status
    ).toBe(200);
    expect(
      (await GET_STATUS(new Request("http://localhost/api/status", { headers: { cookie } }))).status
    ).toBe(200);

    const patchDenied = await PATCH(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "PATCH",
        headers: { cookie, "content-type": "application/json" },
        body: JSON.stringify({ ttlDays: null })
      }),
      context
    );
    expect(patchDenied.status).toBe(401);

    const csrfDenied = await DELETE(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "DELETE",
        headers: { cookie }
      }),
      context
    );
    expect(csrfDenied.status).toBe(403);
    await expect(csrfDenied.json()).resolves.toMatchObject({
      error: { code: "ADMIN_CSRF_FAILED" }
    });

    const deleted = await DELETE(
      new Request(`http://localhost/api/documents/${created.id}`, {
        method: "DELETE",
        headers: { cookie, "x-md-share-csrf": loginBody.csrfToken }
      }),
      context
    );
    expect(deleted.status).toBe(204);
  });
});
