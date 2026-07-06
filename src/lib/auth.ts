import crypto from "node:crypto";

export type UploadAuthResult = { ok: true } | { ok: false; status: number; message: string };

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function checkUploadAuth(request: Request): UploadAuthResult {
  if (process.env.MD_SHARE_ALLOW_ANONYMOUS_UPLOADS === "true") return { ok: true };
  const token = process.env.MD_SHARE_UPLOAD_TOKEN;
  if (!token) {
    if (process.env.NODE_ENV !== "production") return { ok: true };
    return {
      ok: false,
      status: 503,
      message: "MD_SHARE_UPLOAD_TOKEN is not configured"
    };
  }
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
  if (provided && safeEqual(provided, token)) return { ok: true };
  return { ok: false, status: 401, message: "invalid upload token" };
}
