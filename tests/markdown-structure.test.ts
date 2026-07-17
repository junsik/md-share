import { describe, expect, it } from "vitest";
import { extractDocumentHeadings, hasLeadingH1 } from "@/lib/markdown-structure";

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

  it("extracts H2 and H3 entries with stable Unicode and duplicate anchors", () => {
    const markdown = `# 문서

## 설치 *준비*

### 세부 \`설정\`

#### 설치 준비

## 설치 준비

개요
----

\`\`\`md
## 코드 안 제목
\`\`\``;

    expect(extractDocumentHeadings(markdown)).toEqual([
      { id: "heading-설치-준비", level: 2, text: "설치 준비" },
      { id: "heading-세부-설정", level: 3, text: "세부 설정" },
      { id: "heading-설치-준비-2", level: 2, text: "설치 준비" },
      { id: "heading-개요", level: 2, text: "개요" }
    ]);
  });

  it("skips empty headings without losing later entries", () => {
    expect(extractDocumentHeadings("##\n\n## Useful")).toEqual([
      { id: "heading-useful", level: 2, text: "Useful" }
    ]);
  });
});
