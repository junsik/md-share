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
  return new Response(document.markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="${document.meta.id}.md"`
    }
  });
}
