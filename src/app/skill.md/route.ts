import { promises as fs } from "node:fs";
import path from "node:path";
import { publicBaseUrl } from "@/lib/url";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the bundled agent skill with this instance's URL substituted in, so
// the install commands shown by the AI dialog work on any self-hosted instance.
export async function GET(request: Request) {
  let template: string;
  try {
    template = await fs.readFile(
      path.join(process.cwd(), "skills", "md-share", "SKILL.md"),
      "utf8"
    );
  } catch {
    return new Response("skill template not bundled in this build", { status: 404 });
  }
  const skill = template.replaceAll("https://md-share.example.com", publicBaseUrl(request));
  return new Response(skill, {
    headers: { "content-type": "text/markdown; charset=utf-8" }
  });
}
