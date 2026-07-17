import crypto from "node:crypto";

type AuthFailure = { ok: false; status: number; message: string };
export type OperatorAuthResult =
  | { ok: true; mode: "operator" | "development" }
  | AuthFailure;
export type UploadAuthResult =
  | { ok: true; mode: "anonymous" | "operator" | "development" }
  | AuthFailure;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1].trim() ?? "";
}

export function isAnonymousUploadEnabled(): boolean {
  return process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS === "true";
}

export function hasOperatorAuth(request: Request): boolean {
  const token = process.env.MD_SHARE_UPLOAD_TOKEN;
  const provided = bearerToken(request);
  return Boolean(token && provided && safeEqual(provided, token));
}

export function checkOperatorAuth(request: Request): OperatorAuthResult {
  const token = process.env.MD_SHARE_UPLOAD_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      return { ok: true, mode: "development" };
    }
    return {
      ok: false,
      status: 503,
      message: "MD_SHARE_UPLOAD_TOKEN is not configured"
    };
  }
  if (hasOperatorAuth(request)) return { ok: true, mode: "operator" };
  return { ok: false, status: 401, message: "invalid operator token" };
}

export function checkUploadAuth(request: Request): UploadAuthResult {
  if (hasOperatorAuth(request)) return { ok: true, mode: "operator" };
  if (isAnonymousUploadEnabled()) return { ok: true, mode: "anonymous" };
  const operatorAuth = checkOperatorAuth(request);
  if (operatorAuth.ok) return operatorAuth;
  return {
    ...operatorAuth,
    message: operatorAuth.status === 401 ? "invalid upload token" : operatorAuth.message
  };
}
