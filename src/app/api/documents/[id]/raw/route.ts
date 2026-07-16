import { getDocument } from "@/lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const document = await getDocument(id);
  if (!document) {
    return new Response("not found", { status: 404 });
  }
  const filename = document.meta.originalFilename ?? `${document.meta.id}.md`;
  const encodedFilename = encodeURIComponent(filename);
  return new Response(document.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="document.md"; filename*=UTF-8''${encodedFilename}`,
      "x-content-type-options": "nosniff"
    }
  });
}
