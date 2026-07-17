import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

async function source(relativePath: string): Promise<string> {
  return readFile(path.join(process.cwd(), relativePath), "utf8");
}

describe("published integration contract", () => {
  it("keeps the package and OpenAPI versions aligned", async () => {
    const packageJson = JSON.parse(await source("package.json")) as { version: string };
    const openapi = await source("public/openapi.yaml");

    expect(packageJson.version).toBe("1.1.0");
    expect(openapi).toContain("version: 1.1.0");
  });

  it("documents every v1 endpoint in the API reference and OpenAPI", async () => {
    const api = await source("docs/API.md");
    const openapi = await source("public/openapi.yaml");
    const endpoints = [
      "/api/documents:",
      "/api/documents/{id}:",
      "/api/documents/{id}/raw:",
      "/api/status:"
    ];

    for (const endpoint of endpoints) {
      expect(openapi).toContain(`  ${endpoint}`);
      expect(api).toContain(endpoint.slice(0, -1));
    }
  });

  it("keeps retry and discovery guidance visible to agents", async () => {
    const skill = await source("skills/md-share/SKILL.md");
    const api = await source("docs/API.md");
    const llms = await source("llms.txt");

    for (const document of [skill, api]) {
      expect(document).toContain("Idempotency-Key");
      expect(document).toContain("filename");
      expect(document).toContain("ttlDays");
    }
    expect(llms).toContain("/openapi.yaml");
    expect(llms).toContain("docs/API.md");
    expect(llms).toContain("skills/md-share/SKILL.md");
  });
});
