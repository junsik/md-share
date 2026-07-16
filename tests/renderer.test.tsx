import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MarkdownView, { urlTransform } from "../src/components/MarkdownView";

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
});
