import { NextResponse } from "next/server";
import { checkOperatorAuth, checkUploadAuth } from "@/lib/auth";
import {
  anonymousRateLimitHeaders,
  checkAnonymousUploadRateLimit
} from "@/lib/anonymous-rate-limit";
import {
  MAX_FILENAME_LENGTH,
  MAX_TITLE_LENGTH,
  validateMarkdownFilename,
  validateMarkdownText
} from "@/lib/input";
import {
  createDocument,
  IdempotencyBusyError,
  IdempotencyConflictError,
  IdempotencyGoneError,
  listDocuments,
  MAX_IDEMPOTENCY_KEY_LENGTH,
  MAX_MARKDOWN_BYTES
} from "@/lib/store";
import { publicBaseUrl, shareUrls } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REQUEST_BYTES = MAX_MARKDOWN_BYTES * 3;

interface CreateRequestBody {
  markdown?: unknown;
  title?: unknown;
  filename?: unknown;
  ttlDays?: unknown;
}

interface ParsedCreateInput {
  markdown: string;
  title?: string;
  originalFilename?: string;
  ttlDays?: number | null;
}

function apiError(code: string, message: string, status: number, headers?: HeadersInit) {
  return NextResponse.json({ error: { code, message } }, { status, headers });
}

function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function validateCommonInput(input: ParsedCreateInput):
  | { ok: true; value: ParsedCreateInput }
  | { ok: false; code: string; message: string } {
  const markdownResult = validateMarkdownText(input.markdown);
  if (!markdownResult.ok) return markdownResult;
  if (input.title !== undefined && input.title.length > MAX_TITLE_LENGTH) {
    return {
      ok: false,
      code: "INVALID_TITLE",
      message: `title must not exceed ${MAX_TITLE_LENGTH} characters`
    };
  }
  if (input.originalFilename !== undefined) {
    const filenameResult = validateMarkdownFilename(input.originalFilename);
    if (!filenameResult.ok) return filenameResult;
    input.originalFilename = filenameResult.value;
  }
  if (
    input.ttlDays !== undefined &&
    input.ttlDays !== null &&
    (!Number.isFinite(input.ttlDays) || input.ttlDays <= 0)
  ) {
    return {
      ok: false,
      code: "INVALID_TTL",
      message: "ttlDays must be a positive number or null"
    };
  }
  return { ok: true, value: input };
}

async function parseCreateInput(request: Request): Promise<
  | { ok: true; value: ParsedCreateInput }
  | { ok: false; code: string; message: string; status?: number }
> {
  const bytes = new Uint8Array(await request.arrayBuffer());
  if (bytes.byteLength > MAX_REQUEST_BYTES) {
    return {
      ok: false,
      code: "REQUEST_TOO_LARGE",
      message: `request exceeds ${MAX_REQUEST_BYTES} bytes`,
      status: 413
    };
  }
  const text = decodeUtf8(bytes);
  if (text === null) {
    return {
      ok: false,
      code: "INVALID_UTF8",
      message: "request body must be valid UTF-8"
    };
  }

  const contentType = (request.headers.get("content-type") ?? "").toLowerCase();
  if (contentType.includes("application/json")) {
    let body: CreateRequestBody;
    try {
      body = JSON.parse(text) as CreateRequestBody;
    } catch {
      return { ok: false, code: "INVALID_JSON", message: "invalid JSON body" };
    }
    if (typeof body.markdown !== "string") {
      return {
        ok: false,
        code: "INVALID_MARKDOWN",
        message: "markdown must be a string"
      };
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return { ok: false, code: "INVALID_TITLE", message: "title must be a string" };
    }
    if (body.filename !== undefined && typeof body.filename !== "string") {
      return {
        ok: false,
        code: "INVALID_FILENAME",
        message: `filename must be a string up to ${MAX_FILENAME_LENGTH} characters`
      };
    }
    if (
      body.ttlDays !== undefined &&
      body.ttlDays !== null &&
      typeof body.ttlDays !== "number"
    ) {
      return {
        ok: false,
        code: "INVALID_TTL",
        message: "ttlDays must be a positive number or null"
      };
    }
    return validateCommonInput({
      markdown: body.markdown,
      title: body.title?.trim() || undefined,
      originalFilename: body.filename,
      ttlDays: body.ttlDays as number | null | undefined
    });
  }

  if (contentType.includes("multipart/form-data")) {
    return {
      ok: false,
      code: "UNSUPPORTED_MEDIA_TYPE",
      message: "use a raw text/markdown body or JSON",
      status: 415
    };
  }
  const params = new URL(request.url).searchParams;
  const ttlRaw = params.get("ttlDays");
  const ttlDays = ttlRaw ? Number(ttlRaw) : undefined;
  return validateCommonInput({
    markdown: text,
    title: params.get("title")?.trim() || undefined,
    originalFilename: params.get("filename") ?? undefined,
    ttlDays
  });
}

function idempotencyKey(request: Request):
  | { ok: true; value?: string }
  | { ok: false; message: string } {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return { ok: true };
  const value = raw.trim();
  if (
    !value ||
    value.length > MAX_IDEMPOTENCY_KEY_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return {
      ok: false,
      message: `Idempotency-Key must contain 1-${MAX_IDEMPOTENCY_KEY_LENGTH} visible characters`
    };
  }
  return { ok: true, value };
}

export async function POST(request: Request) {
  const auth = checkUploadAuth(request);
  if (!auth.ok) {
    return apiError("UPLOAD_AUTH_FAILED", auth.message, auth.status);
  }
  const rateLimit =
    auth.mode === "anonymous" ? checkAnonymousUploadRateLimit(request) : undefined;
  if (rateLimit && !rateLimit.allowed) {
    return apiError(
      "ANONYMOUS_UPLOAD_RATE_LIMITED",
      "anonymous upload rate limit exceeded",
      429,
      anonymousRateLimitHeaders(rateLimit)
    );
  }
  const key = idempotencyKey(request);
  if (!key.ok) {
    return apiError("INVALID_IDEMPOTENCY_KEY", key.message, 400);
  }
  const input = await parseCreateInput(request);
  if (!input.ok) {
    return apiError(input.code, input.message, input.status ?? 400);
  }
  if (Buffer.byteLength(input.value.markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return apiError(
      "DOCUMENT_TOO_LARGE",
      `markdown exceeds ${MAX_MARKDOWN_BYTES} bytes`,
      413
    );
  }

  try {
    const result = await createDocument(input.value, key.value);
    const urls = shareUrls(publicBaseUrl(request), result.meta.id);
    return NextResponse.json(
      {
        ...result.meta,
        ...urls,
        replayed: result.replayed,
        ...(result.manageToken ? { manageToken: result.manageToken } : {})
      },
      {
        status: result.replayed ? 200 : 201,
        ...(rateLimit ? { headers: anonymousRateLimitHeaders(rateLimit) } : {})
      }
    );
  } catch (error) {
    if (error instanceof IdempotencyConflictError) {
      return apiError("IDEMPOTENCY_CONFLICT", error.message, 409);
    }
    if (error instanceof IdempotencyGoneError) {
      return apiError("IDEMPOTENCY_GONE", error.message, 410);
    }
    if (error instanceof IdempotencyBusyError) {
      return apiError("IDEMPOTENCY_BUSY", error.message, 503, { "Retry-After": "1" });
    }
    console.error("document_create_failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return apiError("STORAGE_UNAVAILABLE", "document could not be stored", 503, {
      "Retry-After": "1"
    });
  }
}

export async function GET(request: Request) {
  const auth = checkOperatorAuth(request);
  if (!auth.ok) {
    return apiError("OPERATOR_AUTH_FAILED", auth.message, auth.status);
  }
  const base = publicBaseUrl(request);
  const documents = (await listDocuments()).map((meta) => ({
    ...meta,
    ...shareUrls(base, meta.id)
  }));
  return NextResponse.json({ documents });
}
