import { NextResponse } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  adminLoginRateLimitHeaders,
  authenticateAdminCredentials,
  createAdminSession,
  hasValidAdminCsrf,
  isSecureRequest,
  readAdminSession,
  revokeAdminSession
} from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_LOGIN_BODY_BYTES = 4_096;

function apiError(code: string, message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function loginInput(value: unknown): { username: string; password: string } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const body = value as Record<string, unknown>;
  if (
    typeof body.username !== "string" ||
    typeof body.password !== "string" ||
    body.username.length < 1 ||
    body.username.length > 128 ||
    body.password.length < 1 ||
    body.password.length > 1_024
  ) {
    return undefined;
  }
  return { username: body.username, password: body.password };
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_LOGIN_BODY_BYTES) {
    return apiError("ADMIN_LOGIN_REQUEST_TOO_LARGE", "login request is too large", 413);
  }

  let value: unknown;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text, "utf8") > MAX_LOGIN_BODY_BYTES) {
      return apiError("ADMIN_LOGIN_REQUEST_TOO_LARGE", "login request is too large", 413);
    }
    value = JSON.parse(text);
  } catch {
    return apiError("INVALID_JSON", "request body must be valid JSON", 400);
  }
  const input = loginInput(value);
  if (!input) {
    return apiError("INVALID_ADMIN_LOGIN", "username and password are required", 400);
  }

  const authentication = authenticateAdminCredentials(
    request,
    input.username,
    input.password
  );
  if (!authentication.ok) {
    return apiError(
      authentication.code,
      authentication.message,
      authentication.status,
      authentication.rateLimit
        ? adminLoginRateLimitHeaders(authentication.rateLimit)
        : undefined
    );
  }

  const created = createAdminSession(authentication.username);
  const response = NextResponse.json(
    { authenticated: true, ...created.session },
    { headers: adminLoginRateLimitHeaders(authentication.rateLimit) }
  );
  response.cookies.set(ADMIN_SESSION_COOKIE, created.token, {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: created.maxAge
  });
  return response;
}

export async function GET(request: Request) {
  const session = readAdminSession(request);
  if (!session) {
    return apiError("ADMIN_SESSION_REQUIRED", "administrator session is required", 401);
  }
  return NextResponse.json({ authenticated: true, ...session });
}

export async function DELETE(request: Request) {
  const session = readAdminSession(request);
  if (!session) {
    return apiError("ADMIN_SESSION_REQUIRED", "administrator session is required", 401);
  }
  if (!hasValidAdminCsrf(request)) {
    return apiError("ADMIN_CSRF_FAILED", "administrator CSRF token is invalid", 403);
  }
  revokeAdminSession(request);
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: isSecureRequest(request),
    sameSite: "strict",
    path: "/",
    maxAge: 0
  });
  return response;
}
