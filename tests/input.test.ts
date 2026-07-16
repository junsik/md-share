import { describe, expect, it } from "vitest";
import { validateMarkdownFilename, validateMarkdownText } from "../src/lib/input";

describe("Markdown input validation", () => {
  it("accepts a plain .md filename", () => {
    expect(validateMarkdownFilename("운영-리포트.md")).toEqual({
      ok: true,
      value: "운영-리포트.md"
    });
  });

  it.each(["report.markdown", "report.pdf", ".md", "../report.md", "dir\\report.md"])(
    "rejects unsupported or unsafe filename %s",
    (filename) => {
      expect(validateMarkdownFilename(filename).ok).toBe(false);
    }
  );

  it("rejects empty and binary-looking Markdown", () => {
    expect(validateMarkdownText("  ").ok).toBe(false);
    expect(validateMarkdownText("# report\u0000binary").ok).toBe(false);
  });
});
