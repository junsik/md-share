import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownView, { urlTransform } from "../src/components/MarkdownView";
import { extractDocumentHeadings } from "../src/lib/markdown-structure";

describe("safe Markdown rendering", () => {
  it("renders GFM tables and the explicit br exception", () => {
    const html = renderToStaticMarkup(
      <MarkdownView markdown={"| A | B |\n| --- | --- |\n| one<br>two | yes |"} />
    );

    expect(html).toContain("<table>");
    expect(html).toContain("one<br/>");
    expect(html).toContain("two</td>");
  });

  it("does not render raw script HTML", () => {
    const html = renderToStaticMarkup(
      <MarkdownView markdown={'# safe\n\n<script>alert("xss")</script>'} />
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(\"xss\")");
  });

  it("allows raster data images but blocks SVG data URLs", () => {
    expect(urlTransform("data:image/png;base64,AAAA", "src")).toBe(
      "data:image/png;base64,AAAA"
    );
    expect(urlTransform("data:image/svg+xml;base64,AAAA", "src")).toBe("");
  });

  it("recognizes Mermaid fenced blocks", () => {
    const html = renderToStaticMarkup(
      <MarkdownView markdown={"```mermaid\nflowchart LR\nA --> B\n```"} />
    );

    expect(html).toContain("Rendering diagram");
  });

  it("adds prefixed stable heading anchors only when requested", () => {
    const markdown = "# 문서\n\n## 같은 제목\n\n#### 같은 제목\n\n## 같은 제목";
    const anchored = renderToStaticMarkup(
      <MarkdownView headingAnchors markdown={markdown} />
    );
    const plain = renderToStaticMarkup(<MarkdownView markdown={markdown} />);

    expect(anchored).toContain('id="heading-문서"');
    expect(anchored).toContain('id="heading-같은-제목"');
    expect(anchored).toContain('id="heading-같은-제목-1"');
    expect(anchored).toContain('id="heading-같은-제목-2"');
    expect(plain).not.toContain('id="heading-');
  });

  it("keeps extracted GFM table-of-contents IDs aligned with rendered headings", () => {
    const markdown = "# 문서\n\n## ~~Old~~ New\n\n#### Old New\n\n## Old New";
    const html = renderToStaticMarkup(<MarkdownView headingAnchors markdown={markdown} />);

    for (const heading of extractDocumentHeadings(markdown)) {
      expect(html).toContain(`id="${heading.id}"`);
    }
  });
});
