import { NextResponse } from "next/server";
import { deleteDocument, getDocument, updateDocumentExpiry } from "@/lib/store";
import { publicBaseUrl, shareUrls } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

function apiError(code: string, message: string, status: number) {
  return NextResponse.json({ error: { code, message } }, { status });
}

function bearerToken(request: Request): string {
  const authorization = request.headers.get("authorization") ?? "";
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match?.[1].trim() ?? "";
}

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const document = await getDocument(id);
  if (!document) return apiError("DOCUMENT_NOT_FOUND", "document not found", 404);
  return NextResponse.json({
    ...document.meta,
    ...shareUrls(publicBaseUrl(request), document.meta.id)
  });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const token = bearerToken(request);
  if (!token) return apiError("MANAGE_AUTH_REQUIRED", "management token is required", 401);

  let body: { ttlDays?: unknown };
  try {
    body = (await request.json()) as { ttlDays?: unknown };
  } catch {
    return apiError("INVALID_JSON", "invalid JSON body", 400);
  }
  if (
    body.ttlDays === undefined ||
    (body.ttlDays !== null &&
      (typeof body.ttlDays !== "number" ||
        !Number.isFinite(body.ttlDays) ||
        body.ttlDays <= 0))
  ) {
    return apiError("INVALID_TTL", "ttlDays must be a positive number or null", 400);
  }

  try {
    const result = await updateDocumentExpiry(id, token, body.ttlDays as number | null);
    if (result.status !== "ok") {
      return result.status === "not_found"
        ? apiError("DOCUMENT_NOT_FOUND", "document not found", 404)
        : apiError("MANAGE_AUTH_FAILED", "management token is invalid", 403);
    }
    return NextResponse.json({
      ...result.value,
      ...shareUrls(publicBaseUrl(request), result.value.id)
    });
  } catch (error) {
    console.error("document_expiry_update_failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return apiError("STORAGE_UNAVAILABLE", "document could not be updated", 503);
  }
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const token = bearerToken(request);
  if (!token) return apiError("MANAGE_AUTH_REQUIRED", "management token is required", 401);
  try {
    const result = await deleteDocument(id, token);
    if (result.status !== "ok") {
      return result.status === "not_found"
        ? apiError("DOCUMENT_NOT_FOUND", "document not found", 404)
        : apiError("MANAGE_AUTH_FAILED", "management token is invalid", 403);
    }
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("document_delete_failed", {
      name: error instanceof Error ? error.name : "UnknownError"
    });
    return apiError("STORAGE_UNAVAILABLE", "document could not be deleted", 503);
  }
}
