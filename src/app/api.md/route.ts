import { promises as fs } from "node:fs";
import path from "node:path";
import { publicBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the bundled API reference with this instance's URL substituted in,
// so examples are copy-paste runnable against the instance serving them.
export async function GET(request: Request) {
  let template: string;
  try {
    template = await fs.readFile(path.join(process.cwd(), "docs", "API.md"), "utf8");
  } catch {
    return new Response("API reference not bundled in this build", { status: 404 });
  }
  const doc = template.replaceAll("https://md-share.example.com", publicBaseUrl(request));
  return new Response(doc, {
    headers: { "content-type": "text/markdown; charset=utf-8" }
  });
}
