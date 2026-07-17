import { describe, expect, it } from "vitest";
import { hasLeadingH1 } from "@/lib/markdown-structure";

describe("Markdown document structure", () => {
  it("recognizes leading ATX and Setext level-one headings", () => {
    expect(hasLeadingH1("# Report\n\nBody")).toBe(true);
    expect(hasLeadingH1("\uFEFF\n\n  # Report #\n\nBody")).toBe(true);
    expect(hasLeadingH1("Report\n======\n\nBody")).toBe(true);
  });

  it("does not treat other leading content as a document title", () => {
    expect(hasLeadingH1("## Section\n\nBody")).toBe(false);
    expect(hasLeadingH1("Introduction\n\n# Later title")).toBe(false);
    expect(hasLeadingH1("Report\n------\n\nBody")).toBe(false);
    expect(hasLeadingH1("```md\n# Example\n```")).toBe(false);
    expect(hasLeadingH1("\n\n")).toBe(false);
  });
});
