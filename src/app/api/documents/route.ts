import { NextResponse } from "next/server";
import { checkUploadAuth } from "@/lib/auth";
import { createDocument, listDocuments, MAX_MARKDOWN_BYTES } from "@/lib/store";
import { publicBaseUrl, shareUrls } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CreateRequestBody {
  markdown?: unknown;
  title?: unknown;
  ttlDays?: unknown;
}

async function parseCreateInput(request: Request): Promise<
  { ok: true; markdown: string; title?: string; ttlDays?: number } | { ok: false; message: string }
> {
  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    let body: CreateRequestBody;
    try {
      body = (await request.json()) as CreateRequestBody;
    } catch {
      return { ok: false, message: "invalid JSON body" };
    }
    if (typeof body.markdown !== "string" || !body.markdown.trim()) {
      return { ok: false, message: "markdown must be a non-empty string" };
    }
    if (body.title !== undefined && typeof body.title !== "string") {
      return { ok: false, message: "title must be a string" };
    }
    if (body.ttlDays !== undefined && (typeof body.ttlDays !== "number" || body.ttlDays <= 0)) {
      return { ok: false, message: "ttlDays must be a positive number" };
    }
    return { ok: true, markdown: body.markdown, title: body.title, ttlDays: body.ttlDays };
  }

  const markdown = await request.text();
  if (!markdown.trim()) {
    return { ok: false, message: "request body must contain markdown text" };
  }
  const params = new URL(request.url).searchParams;
  const title = params.get("title") ?? undefined;
  const ttlRaw = params.get("ttlDays");
  const ttlDays = ttlRaw ? Number(ttlRaw) : undefined;
  if (ttlDays !== undefined && (!Number.isFinite(ttlDays) || ttlDays <= 0)) {
    return { ok: false, message: "ttlDays must be a positive number" };
  }
  return { ok: true, markdown, title, ttlDays };
}

export async function POST(request: Request) {
  const auth = checkUploadAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const input = await parseCreateInput(request);
  if (!input.ok) {
    return NextResponse.json({ error: input.message }, { status: 400 });
  }
  if (Buffer.byteLength(input.markdown, "utf8") > MAX_MARKDOWN_BYTES) {
    return NextResponse.json(
      { error: `markdown exceeds ${MAX_MARKDOWN_BYTES} bytes` },
      { status: 413 }
    );
  }
  const meta = await createDocument({
    markdown: input.markdown,
    title: input.title,
    ttlDays: input.ttlDays
  });
  const urls = shareUrls(publicBaseUrl(request), meta.id);
  return NextResponse.json({ ...meta, ...urls }, { status: 201 });
}

export async function GET(request: Request) {
  const auth = checkUploadAuth(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }
  const base = publicBaseUrl(request);
  const documents = (await listDocuments()).map((meta) => ({
    ...meta,
    ...shareUrls(base, meta.id)
  }));
  return NextResponse.json({ documents });
}
