"use client";

import { isValidElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import MermaidBlock from "./MermaidBlock";

function extractMermaidCode(children: ReactNode): string | null {
  if (!isValidElement(children)) return null;
  const element = children as ReactElement<{ className?: string; children?: ReactNode }>;
  const className = element.props.className ?? "";
  if (!className.split(/\s+/).includes("language-mermaid")) return null;
  const code = element.props.children;
  if (typeof code === "string") return code;
  if (Array.isArray(code) && code.every((part) => typeof part === "string")) {
    return code.join("");
  }
  return null;
}

function Pre(props: ComponentProps<"pre">) {
  const mermaidCode = extractMermaidCode(props.children);
  if (mermaidCode != null) {
    return <MermaidBlock code={mermaidCode.trim()} />;
  }
  return <pre {...props} />;
}

// GFM table rows are single lines, so `<br>` is the only way to break a line
// inside a cell. Raw HTML stays unrendered for safety; convert just that one
// tag into a real hard break before the HTML pass discards it.
type MdastNode = { type: string; value?: string; children?: MdastNode[] };

function remarkBrToBreak() {
  return (tree: MdastNode) => {
    const walk = (node: MdastNode) => {
      if (!node.children) return;
      node.children = node.children.map((child) =>
        child.type === "html" && /^<br\s*\/?>$/i.test((child.value ?? "").trim())
          ? { type: "break" }
          : child,
      );
      node.children.forEach(walk);
    };
    walk(tree);
  };
}

// react-markdown's default transform strips all data: URIs (safe default —
// data:text/html would be XSS). Self-contained documents legitimately embed
// screenshots as data:image, so allow raster images on img src only:
// clickable data: links and SVG (script-capable as a document) stay blocked.
function urlTransform(url: string, key: string) {
  if (key === "src" && /^data:image\/(png|jpeg|gif|webp);base64,/i.test(url)) {
    return url;
  }
  return defaultUrlTransform(url);
}

export default function MarkdownView({ markdown }: { markdown: string }) {
  return (
    <article className="prose prose-invert max-w-none prose-pre:bg-[#0d1117] prose-pre:border prose-pre:border-border prose-code:before:content-none prose-code:after:content-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBrToBreak]}
        rehypePlugins={[[rehypeHighlight, { plainText: ["mermaid"] }]]}
        components={{ pre: Pre }}
        urlTransform={urlTransform}
      >
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
