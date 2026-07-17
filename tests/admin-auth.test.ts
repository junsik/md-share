import { afterEach, describe, expect, it } from "vitest";
import {
  DELETE as DELETE_SESSION,
  GET as GET_SESSION,
  POST as POST_SESSION
} from "../src/app/api/admin/session/route";
import { resetAdminAuthState } from "../src/lib/admin-auth";

function loginRequest(username: string, password: string, headers: HeadersInit = {}) {
  return new Request("http://localhost/api/admin/session", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ username, password })
  });
}

describe.sequential("administrator session authentication", () => {
  afterEach(() => {
    delete process.env.MD_SHARE_ADMIN_USERNAME;
    delete process.env.MD_SHARE_ADMIN_PASSWORD;
    delete process.env.MD_SHARE_ADMIN_LOGIN_LIMIT;
    delete process.env.MD_SHARE_ADMIN_LOGIN_GLOBAL_LIMIT;
    delete process.env.MD_SHARE_ADMIN_LOGIN_WINDOW_SECONDS;
    delete process.env.MD_SHARE_ADMIN_SESSION_TTL_SECONDS;
    resetAdminAuthState();
  });

  it("requires installer-provided credentials with an eight-character minimum", async () => {
    const missing = await POST_SESSION(loginRequest("admin", "not-configured"));
    expect(missing.status).toBe(503);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "ADMIN_AUTH_NOT_CONFIGURED" }
    });

    process.env.MD_SHARE_ADMIN_USERNAME = "operations";
    process.env.MD_SHARE_ADMIN_PASSWORD = "short-7";
    expect((await POST_SESSION(loginRequest("operations", "short-7"))).status).toBe(503);

    process.env.MD_SHARE_ADMIN_PASSWORD = "eight-ok";
    expect((await POST_SESSION(loginRequest("operations", "eight-ok"))).status).toBe(200);
  });

  it("exchanges valid credentials for an HttpOnly session and supports CSRF-protected logout", async () => {
    process.env.MD_SHARE_ADMIN_USERNAME = "operations";
    process.env.MD_SHARE_ADMIN_PASSWORD = "installer-chosen-password";
    process.env.MD_SHARE_ADMIN_SESSION_TTL_SECONDS = "3600";

    const invalid = await POST_SESSION(loginRequest("operations", "wrong-password-value"));
    expect(invalid.status).toBe(401);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "ADMIN_AUTH_FAILED", message: "invalid administrator credentials" }
    });

    const login = await POST_SESSION(
      loginRequest("operations", "installer-chosen-password")
    );
    expect(login.status).toBe(200);
    const loginBody = await login.json();
    expect(loginBody).toMatchObject({
      authenticated: true,
      username: "operations",
      csrfToken: expect.any(String)
    });
    expect(JSON.stringify(loginBody)).not.toContain("installer-chosen-password");
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("md_share_admin_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Max-Age=3600");
    expect(setCookie).not.toContain("Secure");
    const cookie = setCookie.split(";", 1)[0];

    const current = await GET_SESSION(
      new Request("http://localhost/api/admin/session", { headers: { cookie } })
    );
    expect(current.status).toBe(200);
    await expect(current.json()).resolves.toMatchObject({ username: "operations" });

    const csrfDenied = await DELETE_SESSION(
      new Request("http://localhost/api/admin/session", { method: "DELETE", headers: { cookie } })
    );
    expect(csrfDenied.status).toBe(403);

    const logout = await DELETE_SESSION(
      new Request("http://localhost/api/admin/session", {
        method: "DELETE",
        headers: { cookie, "x-md-share-csrf": loginBody.csrfToken }
      })
    );
    expect(logout.status).toBe(204);
    expect(
      (
        await GET_SESSION(
          new Request("http://localhost/api/admin/session", { headers: { cookie } })
        )
      ).status
    ).toBe(401);
  });

  it("sets Secure behind HTTPS and limits repeated login attempts", async () => {
    process.env.MD_SHARE_ADMIN_USERNAME = "operations";
    process.env.MD_SHARE_ADMIN_PASSWORD = "installer-chosen-password";
    process.env.MD_SHARE_ADMIN_LOGIN_LIMIT = "2";
    process.env.MD_SHARE_ADMIN_LOGIN_GLOBAL_LIMIT = "10";

    const headers = { "x-real-ip": "192.0.2.30" };
    expect((await POST_SESSION(loginRequest("operations", "wrong-password-1", headers))).status).toBe(
      401
    );
    expect((await POST_SESSION(loginRequest("operations", "wrong-password-2", headers))).status).toBe(
      401
    );
    const limited = await POST_SESSION(
      loginRequest("operations", "installer-chosen-password", headers)
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBeTruthy();
    expect(limited.headers.get("x-ratelimit-scope")).toBe("client");

    resetAdminAuthState();
    const secure = await POST_SESSION(
      loginRequest("operations", "installer-chosen-password", { "x-forwarded-proto": "https" })
    );
    expect(secure.headers.get("set-cookie")).toContain("Secure");
  });
});
